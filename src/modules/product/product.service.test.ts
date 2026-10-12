import { Role } from '../../generated/prisma/client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../types/errors';
import * as productRepository from './product.repository';
import type { ProductDetail } from './product.repository';
import * as productService from './product.service';

// DB 없이 서비스 규칙만 확인한다.
jest.mock('./product.repository');

const repository = jest.mocked(productRepository);

const ORGANIZATION_ID = 1;
const OWNER_ID = 10;
const OTHER_USER_ID = 20;

function requester(userId: number, role: Role = Role.GENERAL) {
  return { userId, role, organizationId: ORGANIZATION_ID };
}

function productDetail(createdById: number): ProductDetail {
  return {
    id: 1,
    name: '새우깡',
    price: 1500,
    imageUrl: null,
    productUrl: null,
    purchaseCount: 0,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    category: { id: 101, name: '과자', parentId: 1 },
    createdBy: { id: createdById, name: '등록자' },
    wishlistCount: 0,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('상품 목록 조회 (searchProducts)', () => {
  const baseParams = {
    organizationId: ORGANIZATION_ID,
    sort: 'latest' as const,
    page: 1,
    limit: 10,
  };

  test('page와 limit으로 skip·take를 계산해 조직 기준으로 조회한다', async () => {
    repository.findMany.mockResolvedValue([[], 30]);

    await productService.searchProducts({ ...baseParams, page: 3 });

    expect(repository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        skip: 20,
        take: 10,
      }),
    );
  });

  test('다음 페이지가 있으면 hasNext가 true다', async () => {
    repository.findMany.mockResolvedValue([[], 25]);

    const result = await productService.searchProducts(baseParams);

    expect(result).toMatchObject({
      totalCount: 25,
      totalPages: 3,
      hasNext: true,
    });
  });

  test('마지막 페이지면 hasNext가 false다', async () => {
    repository.findMany.mockResolvedValue([[], 25]);

    const result = await productService.searchProducts({
      ...baseParams,
      page: 3,
    });

    expect(result.hasNext).toBe(false);
  });

  test('결과가 0건이어도 1페이지는 빈 목록으로 응답한다', async () => {
    repository.findMany.mockResolvedValue([[], 0]);

    const result = await productService.searchProducts(baseParams);

    expect(result).toMatchObject({
      products: [],
      totalPages: 0,
      hasNext: false,
    });
  });

  test('마지막 페이지를 넘으면 400을 던진다', async () => {
    repository.findMany.mockResolvedValue([[], 25]);

    const promise = productService.searchProducts({ ...baseParams, page: 4 });

    await expect(promise).rejects.toThrow(
      new BadRequestError('page는 3 이하여야 합니다.'),
    );
  });
});

describe('상품 상세 조회 (getProduct)', () => {
  test('등록자 본인이 보면 isMine이 true다', async () => {
    repository.findDetailById.mockResolvedValue(productDetail(OWNER_ID));

    const result = await productService.getProduct(1, requester(OWNER_ID));

    expect(result.isMine).toBe(true);
  });

  test('다른 사람이 보면 isMine이 false다', async () => {
    repository.findDetailById.mockResolvedValue(productDetail(OWNER_ID));

    const result = await productService.getProduct(1, requester(OTHER_USER_ID));

    expect(result.isMine).toBe(false);
  });

  test('요청자 조직 기준으로 찾는다', async () => {
    repository.findDetailById.mockResolvedValue(productDetail(OWNER_ID));

    await productService.getProduct(1, requester(OWNER_ID));

    expect(repository.findDetailById).toHaveBeenCalledWith(1, ORGANIZATION_ID);
  });

  test('없거나 다른 조직의 상품이면 404를 던진다', async () => {
    repository.findDetailById.mockResolvedValue(null);

    const promise = productService.getProduct(1, requester(OWNER_ID));

    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('상품 등록 (createProduct)', () => {
  const input = { name: '새우깡', price: 1500, categoryId: 101 };

  test('등록자와 조직은 요청자 정보로 채운다', async () => {
    repository.findCategoryById.mockResolvedValue({ id: 101 });
    repository.create.mockResolvedValue(productDetail(OWNER_ID));

    const result = await productService.createProduct({
      ...input,
      requester: requester(OWNER_ID),
    });

    expect(repository.create).toHaveBeenCalledWith({
      ...input,
      createdById: OWNER_ID,
      organizationId: ORGANIZATION_ID,
    });
    expect(result.isMine).toBe(true);
  });

  test('없는 카테고리면 저장하지 않고 400을 던진다', async () => {
    repository.findCategoryById.mockResolvedValue(null);

    const promise = productService.createProduct({
      ...input,
      requester: requester(OWNER_ID),
    });

    await expect(promise).rejects.toThrow(
      new BadRequestError('존재하지 않는 카테고리입니다.'),
    );
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe('상품 수정·삭제 권한', () => {
  const owner = { id: 1, createdById: OWNER_ID };

  test('등록자 본인은 수정할 수 있다', async () => {
    repository.findOwnerById.mockResolvedValue(owner);
    repository.update.mockResolvedValue(productDetail(OWNER_ID));

    await productService.updateProduct({
      productId: 1,
      requester: requester(OWNER_ID),
      data: { price: 2000 },
    });

    expect(repository.update).toHaveBeenCalledWith(1, { price: 2000 });
  });

  test.each([Role.ADMIN, Role.SUPER_ADMIN])(
    '%s는 남이 등록한 상품도 삭제할 수 있다',
    async (role) => {
      repository.findOwnerById.mockResolvedValue(owner);
      repository.softDelete.mockResolvedValue({ id: 1 });

      const result = await productService.deleteProduct({
        productId: 1,
        requester: requester(OTHER_USER_ID, role),
      });

      expect(result).toEqual({ id: 1 });
    },
  );

  test('일반 회원은 남이 등록한 상품을 수정할 수 없다', async () => {
    repository.findOwnerById.mockResolvedValue(owner);

    const promise = productService.updateProduct({
      productId: 1,
      requester: requester(OTHER_USER_ID),
      data: { price: 2000 },
    });

    await expect(promise).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.update).not.toHaveBeenCalled();
  });

  test('일반 회원은 남이 등록한 상품을 삭제할 수 없다', async () => {
    repository.findOwnerById.mockResolvedValue(owner);

    const promise = productService.deleteProduct({
      productId: 1,
      requester: requester(OTHER_USER_ID),
    });

    await expect(promise).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  test('없거나 다른 조직의 상품이면 404를 던진다', async () => {
    repository.findOwnerById.mockResolvedValue(null);

    const promise = productService.deleteProduct({
      productId: 1,
      requester: requester(OWNER_ID, Role.SUPER_ADMIN),
    });

    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    expect(repository.findOwnerById).toHaveBeenCalledWith(1, ORGANIZATION_ID);
  });

  test('수정에서 카테고리를 바꾸면 존재 여부를 확인한다', async () => {
    repository.findOwnerById.mockResolvedValue(owner);
    repository.findCategoryById.mockResolvedValue(null);

    const promise = productService.updateProduct({
      productId: 1,
      requester: requester(OWNER_ID),
      data: { categoryId: 999 },
    });

    await expect(promise).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.update).not.toHaveBeenCalled();
  });
});
