import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  S3ServiceException,
} from '@aws-sdk/client-s3';

import { findMissingS3Env, getS3Bucket, getS3Client } from '../../config/s3';
import { Role } from '../../generated/prisma/client';
import { ForbiddenError, NotFoundError } from '../../types/errors';
import * as imageRepository from './image.repository';

// 컨트롤러가 넘기는 req.auth 중 권한 판단에 쓰는 값만 받는다.
type Requester = {
  userId: number;
  role: Role;
  organizationId: number;
};

type ImageObject = {
  body: Readable;
  contentType: string;
  contentLength?: number;
};

function assertS3Env(): void {
  const missingEnv = findMissingS3Env();

  if (missingEnv.length > 0) {
    throw new Error(`이미지 설정이 없습니다. .env에 ${missingEnv.join(', ')}`);
  }
}

/*
없는 이미지를 요청했을 때 S3가 주는 응답이 IAM 권한에 따라 다르다.
- s3:ListBucket이 있으면 404 NoSuchKey
- 없으면 403 AccessDenied (파일이 있는지조차 알려주지 않는다)
둘 다 "이미지가 없다"로 보고 404로 맞춘다. 다만 403은 버킷명·리전·권한이
잘못됐을 때도 나오므로, 설정 문제를 놓치지 않게 서버 로그는 남긴다.
*/
function isImageNotFound(error: unknown): boolean {
  if (error instanceof NoSuchKey) return true;

  if (
    error instanceof S3ServiceException &&
    error.$metadata.httpStatusCode === 403
  ) {
    console.error('S3 AccessDenied (버킷·리전·IAM 권한 확인 필요):', error);
    return true;
  }

  return false;
}

export async function getImageObject(imageKey: string): Promise<ImageObject> {
  assertS3Env();

  try {
    const result = await getS3Client().send(
      new GetObjectCommand({ Bucket: getS3Bucket(), Key: imageKey }),
    );

    if (!(result.Body instanceof Readable)) {
      throw new Error('S3 응답에서 이미지 스트림을 받지 못했습니다.');
    }

    return {
      body: result.Body,
      contentType: result.ContentType ?? 'application/octet-stream',
      contentLength: result.ContentLength,
    };
  } catch (error) {
    if (isImageNotFound(error)) {
      throw new NotFoundError('이미지를 찾을 수 없습니다.');
    }

    throw error;
  }
}

// S3의 DeleteObject는 없는 key여도 성공으로 응답한다.
export async function deleteImageObject(imageKey: string): Promise<void> {
  assertS3Env();

  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: imageKey }),
  );
}

/**
 * 업로드한 이미지를 누가 어느 조직에서 올렸는지 기록한다.
 * 기록에 실패하면 S3 파일은 아무도 지울 수 없는 고아가 되므로 바로 지운다.
 */
export async function recordUploadedImage(
  key: string,
  requester: Requester,
): Promise<void> {
  try {
    await imageRepository.create({
      key,
      uploadedById: requester.userId,
      organizationId: requester.organizationId,
    });
  } catch (error) {
    await deleteImageObject(key).catch((cleanupError: unknown) => {
      console.error(
        '업로드 기록 실패 후 S3 파일 정리 실패:',
        key,
        cleanupError,
      );
    });

    throw error;
  }
}

/*
삭제 권한
- 업로드한 본인 또는 같은 조직의 관리자 이상
- 다른 조직의 이미지는 있는지조차 알려주지 않도록 404
- 기록이 없는 이미지(Image 테이블 도입 전 업로드)는 누가 올렸는지 모르므로 관리자 이상만
*/
export async function deleteImage(
  key: string,
  requester: Requester,
): Promise<void> {
  const owner = await imageRepository.findOwnerByKey(key);
  const isAdmin =
    requester.role === Role.ADMIN || requester.role === Role.SUPER_ADMIN;

  if (owner && owner.organizationId !== requester.organizationId) {
    throw new NotFoundError('이미지를 찾을 수 없습니다.');
  }

  const isUploader = owner?.uploadedById === requester.userId;

  if (!isUploader && !isAdmin) {
    throw new ForbiddenError('본인이 올린 이미지만 삭제할 수 있습니다.');
  }

  // S3를 먼저 지운다. S3가 실패하면 DB는 그대로라 다시 시도할 수 있고,
  // DB가 실패하면 기록이 남아 고아 이미지 정리에서 다시 지운다(DeleteObject는 멱등).
  await deleteImageObject(key);
  await imageRepository.deleteByKey(key, requester.organizationId);
}

type CleanupOptions = {
  // 이 시각보다 먼저 올린 이미지만 본다. 업로드 직후 상품 등록 전인 이미지를 지우지 않으려는 것이다.
  createdBefore: Date;
  batchSize?: number;
};

/**
 * 어느 상품에도 쓰이지 않는 이미지를 S3와 DB에서 지우고 지운 개수를 돌려준다.
 * 상품 등록을 취소했거나 이미지를 바꿔 끼운 경우 이전 파일이 여기에 해당한다.
 */
export async function cleanupOrphanImages({
  createdBefore,
  batchSize = 100,
}: CleanupOptions): Promise<number> {
  assertS3Env();

  let deletedCount = 0;
  let afterId = 0;

  for (;;) {
    const images = await imageRepository.findCreatedBefore(
      createdBefore,
      batchSize,
      afterId,
    );

    if (images.length === 0) return deletedCount;

    afterId = images[images.length - 1].id;

    const keysInUse = await imageRepository.findKeysInUse(
      images.map((image) => image.key),
    );
    const orphanKeys = images
      .map((image) => image.key)
      .filter((key) => !keysInUse.has(key));

    // 한 파일이 실패해도 나머지는 계속 지운다. 실패한 기록은 남겨 다음 실행에서 다시 시도한다.
    const deletedKeys: string[] = [];

    for (const key of orphanKeys) {
      try {
        await deleteImageObject(key);
        deletedKeys.push(key);
      } catch (error) {
        console.error('고아 이미지 S3 삭제 실패:', key, error);
      }
    }

    if (deletedKeys.length > 0) {
      deletedCount += await imageRepository.deleteManyByKeys(deletedKeys);
    }
  }
}
