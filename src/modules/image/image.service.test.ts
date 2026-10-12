import { DeleteObjectCommand } from '@aws-sdk/client-s3';

import { getS3Client } from '../../config/s3';
import { Role } from '../../generated/prisma/client';
import { ForbiddenError, NotFoundError } from '../../types/errors';
import * as imageRepository from './image.repository';
import * as imageService from './image.service';

// DB와 S3 없이 서비스 규칙만 확인한다.
jest.mock('./image.repository');
jest.mock('../../config/s3', () => {
  // 서명 URL은 실제 클라이언트 설정으로 계산하므로 가짜 자격 증명을 넣은 진짜 S3Client를 쓴다.
  // send만 가로채서 S3로 요청이 나가지 않게 한다.
  const { S3Client } = jest.requireActual('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'ap-northeast-2',
    credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'test-secret' },
  });
  client.send = jest.fn();

  return {
    getS3Client: () => client,
    getS3Bucket: () => 'test-bucket',
    findMissingS3Env: () => [],
  };
});

const repository = jest.mocked(imageRepository);
const s3Send = jest.mocked(getS3Client().send);

const KEY = 'public/products/a.png';
const ORGANIZATION_ID = 1;
const UPLOADER_ID = 10;
const OTHER_USER_ID = 20;

function requester(
  userId: number,
  role: Role = Role.GENERAL,
  organizationId = ORGANIZATION_ID,
) {
  return { userId, role, organizationId };
}

function deletedS3Keys(): unknown[] {
  return s3Send.mock.calls.map(([command]) => {
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    return (command as DeleteObjectCommand).input.Key;
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('업로드 기록 (recordUploadedImage)', () => {
  test('업로드한 사람과 조직을 기록한다', async () => {
    repository.create.mockResolvedValue({ id: 1 });

    await imageService.recordUploadedImage(KEY, requester(UPLOADER_ID));

    expect(repository.create).toHaveBeenCalledWith({
      key: KEY,
      uploadedById: UPLOADER_ID,
      organizationId: ORGANIZATION_ID,
    });
    expect(s3Send).not.toHaveBeenCalled();
  });

  test('기록에 실패하면 S3 파일을 지우고 에러를 다시 던진다', async () => {
    const dbError = new Error('db down');
    repository.create.mockRejectedValue(dbError);

    const promise = imageService.recordUploadedImage(
      KEY,
      requester(UPLOADER_ID),
    );

    await expect(promise).rejects.toBe(dbError);
    expect(deletedS3Keys()).toEqual([KEY]);
  });
});

describe('이미지 삭제 권한 (deleteImage)', () => {
  const owner = { uploadedById: UPLOADER_ID, organizationId: ORGANIZATION_ID };

  test('업로드한 본인은 일반 회원이어도 지울 수 있다', async () => {
    repository.findOwnerByKey.mockResolvedValue(owner);

    await imageService.deleteImage(KEY, requester(UPLOADER_ID));

    expect(deletedS3Keys()).toEqual([KEY]);
    expect(repository.deleteByKey).toHaveBeenCalledWith(KEY, ORGANIZATION_ID);
  });

  test('같은 조직의 관리자는 남이 올린 이미지도 지울 수 있다', async () => {
    repository.findOwnerByKey.mockResolvedValue(owner);

    await imageService.deleteImage(KEY, requester(OTHER_USER_ID, Role.ADMIN));

    expect(repository.deleteByKey).toHaveBeenCalledWith(KEY, ORGANIZATION_ID);
  });

  test('일반 회원은 남이 올린 이미지를 지울 수 없다', async () => {
    repository.findOwnerByKey.mockResolvedValue(owner);

    const promise = imageService.deleteImage(KEY, requester(OTHER_USER_ID));

    await expect(promise).rejects.toBeInstanceOf(ForbiddenError);
    expect(s3Send).not.toHaveBeenCalled();
  });

  test('다른 조직의 이미지는 관리자여도 404다', async () => {
    repository.findOwnerByKey.mockResolvedValue(owner);

    const promise = imageService.deleteImage(
      KEY,
      requester(OTHER_USER_ID, Role.SUPER_ADMIN, 2),
    );

    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    expect(s3Send).not.toHaveBeenCalled();
  });

  test('기록이 없는 예전 이미지는 관리자만 지울 수 있다', async () => {
    repository.findOwnerByKey.mockResolvedValue(null);

    await expect(
      imageService.deleteImage(KEY, requester(UPLOADER_ID)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await imageService.deleteImage(KEY, requester(UPLOADER_ID, Role.ADMIN));
    expect(repository.deleteByKey).toHaveBeenCalledWith(KEY, ORGANIZATION_ID);
  });

  test('S3 삭제에 실패하면 DB 기록은 건드리지 않는다', async () => {
    repository.findOwnerByKey.mockResolvedValue(owner);
    s3Send.mockRejectedValue(new Error('s3 down') as never);

    const promise = imageService.deleteImage(KEY, requester(UPLOADER_ID));

    await expect(promise).rejects.toThrow('s3 down');
    expect(repository.deleteByKey).not.toHaveBeenCalled();
  });
});

describe('고아 이미지 정리 (cleanupOrphanImages)', () => {
  const createdBefore = new Date('2026-10-01');

  test('상품이 쓰지 않는 이미지만 S3와 DB에서 지운다', async () => {
    repository.findCreatedBefore
      .mockResolvedValueOnce([
        { id: 1, key: 'public/products/used.png' },
        { id: 2, key: 'public/products/orphan.png' },
      ])
      .mockResolvedValueOnce([]);
    repository.findKeysInUse.mockResolvedValue(
      new Set(['public/products/used.png']),
    );
    repository.deleteManyByKeys.mockResolvedValue(1);

    const deletedCount = await imageService.cleanupOrphanImages({
      createdBefore,
    });

    expect(deletedCount).toBe(1);
    expect(deletedS3Keys()).toEqual(['public/products/orphan.png']);
    expect(repository.deleteManyByKeys).toHaveBeenCalledWith([
      'public/products/orphan.png',
    ]);
  });

  test('다음 배치는 마지막 id 뒤에서부터 읽는다', async () => {
    repository.findCreatedBefore
      .mockResolvedValueOnce([{ id: 7, key: 'public/products/a.png' }])
      .mockResolvedValueOnce([]);
    repository.findKeysInUse.mockResolvedValue(
      new Set(['public/products/a.png']),
    );

    await imageService.cleanupOrphanImages({ createdBefore, batchSize: 1 });

    expect(repository.findCreatedBefore).toHaveBeenNthCalledWith(
      2,
      createdBefore,
      1,
      7,
    );
  });

  test('S3 삭제에 실패한 이미지는 기록을 남겨 다음에 다시 시도한다', async () => {
    repository.findCreatedBefore
      .mockResolvedValueOnce([
        { id: 1, key: 'public/products/fail.png' },
        { id: 2, key: 'public/products/ok.png' },
      ])
      .mockResolvedValueOnce([]);
    repository.findKeysInUse.mockResolvedValue(new Set());
    repository.deleteManyByKeys.mockResolvedValue(1);
    s3Send
      .mockRejectedValueOnce(new Error('s3 down') as never)
      .mockResolvedValueOnce({} as never);

    const deletedCount = await imageService.cleanupOrphanImages({
      createdBefore,
    });

    expect(deletedCount).toBe(1);
    expect(repository.deleteManyByKeys).toHaveBeenCalledWith([
      'public/products/ok.png',
    ]);
  });
});

describe('리다이렉트 방식 이미지 제공 (getImageRedirect)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('IMAGE_DELIVERY_MODE가 redirect일 때만 리다이렉트 방식이다', () => {
    delete process.env.IMAGE_DELIVERY_MODE;
    expect(imageService.isImageRedirectMode()).toBe(false);

    process.env.IMAGE_DELIVERY_MODE = 'redirect';
    expect(imageService.isImageRedirectMode()).toBe(true);
  });

  test('CDN 주소가 없으면 1시간짜리 S3 presigned URL을 만든다', async () => {
    delete process.env.IMAGE_CDN_BASE_URL;

    const redirect = await imageService.getImageRedirect(KEY);
    const url = new URL(redirect.url);

    expect(url.hostname).toBe('test-bucket.s3.ap-northeast-2.amazonaws.com');
    expect(url.pathname).toBe(`/${KEY}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    // 요청마다 달라지는 주소라 공용 캐시에 담지 않고, 만료 전에 다시 받게 한다.
    expect(redirect.cacheControl).toBe('private, max-age=3300');
    // 서명은 계산만 하고 S3로 요청을 보내지 않는다.
    expect(s3Send).not.toHaveBeenCalled();
  });

  test('CDN 주소가 있으면 CloudFront 주소로 보낸다 (끝 슬래시 정리)', async () => {
    process.env.IMAGE_CDN_BASE_URL = 'https://cdn.example.com/';

    const redirect = await imageService.getImageRedirect(KEY);

    expect(redirect).toEqual({
      url: `https://cdn.example.com/${KEY}`,
      cacheControl: 'public, max-age=86400',
    });
  });
});
