import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

/*
@ 이미지 제공 방식 (IMAGE_DELIVERY_MODE)
- proxy(기본): 서버가 S3에서 받아 그대로 흘려보낸다. 설정이 간단하지만 이미지 트래픽이 모두 EC2를 지난다.
- redirect: 짧게 유효한 주소로 302 리다이렉트해 브라우저가 이미지를 직접 받게 한다.
  IMAGE_CDN_BASE_URL이 있으면 CloudFront 주소로, 없으면 S3 presigned URL로 보낸다.
- DB의 imageUrl은 항상 우리 API 경로(/images/<key>)라서, 방식을 바꿔도 저장된 데이터는 그대로다.
*/

const PRESIGNED_URL_EXPIRES_SECONDS = 60 * 60;
// 만료 직전 주소를 브라우저가 캐시에서 꺼내 쓰지 않도록 리다이렉트 응답은 5분 먼저 만료시킨다.
const PRESIGNED_REDIRECT_MAX_AGE_SECONDS = PRESIGNED_URL_EXPIRES_SECONDS - 300;
// CDN 주소는 바뀌지 않으므로 리다이렉트 응답도 길게 캐시한다.
const CDN_REDIRECT_MAX_AGE_SECONDS = 60 * 60 * 24;

export type ImageRedirect = {
  url: string;
  cacheControl: string;
};

export function isImageRedirectMode(): boolean {
  return process.env.IMAGE_DELIVERY_MODE?.trim() === 'redirect';
}

export async function getImageRedirect(
  imageKey: string,
): Promise<ImageRedirect> {
  const cdnBaseUrl = process.env.IMAGE_CDN_BASE_URL?.trim().replace(/\/+$/, '');

  if (cdnBaseUrl) {
    return {
      url: `${cdnBaseUrl}/${imageKey}`,
      cacheControl: `public, max-age=${CDN_REDIRECT_MAX_AGE_SECONDS}`,
    };
  }

  assertS3Env();

  // 서명은 서버 안에서 계산만 하므로 S3에 요청을 보내지 않는다.
  // 그래서 없는 key도 주소는 만들어지고, 404 대신 S3가 직접 에러를 준다.
  const url = await getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: getS3Bucket(), Key: imageKey }),
    { expiresIn: PRESIGNED_URL_EXPIRES_SECONDS },
  );

  // presigned URL은 요청마다 달라 공용 캐시(CDN)에 담기면 안 된다.
  return {
    url,
    cacheControl: `private, max-age=${PRESIGNED_REDIRECT_MAX_AGE_SECONDS}`,
  };
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
