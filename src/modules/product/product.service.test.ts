import { Role } from '../../generated/prisma/client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../types/errors';
import { invalidateProductListCache } from './product.cache';
import { encodeProductCursor } from './product.cursor';
import * as productRepository from './product.repository';
import type { ProductDetail } from './product.repository';
import * as productService from './product.service';

// DB 없이 서비스 규칙만 확인한다.
jest.mock('./product.repository');
// 캐시는 product.cache.test.ts에서 따로 확인하고, 여기서는 항상 원본을 읽게 한다.
jest.mock('./product.cache', () => ({
  getCachedProductList: (_params: unknown, load: () => unknown) => load(),
  invalidateProductListCache: jest.fn(),
}));

const repository = jest.mocked(productRepository);

const ORGANIZATION_ID = 1;
const OWNER_ID = 10;
const OTHER_USER_ID = 20;

function requester(userId: number, role: Role = Role.GENERAL) {
  return { userId, role, organizationId: ORGANIZATION_ID };
}

function listItem(id: number) {
  return {
    id,
    name: `상품 ${id}`,
    price: 1000,
    imageUrl: null,
    productUrl: null,
    purchaseCount: 0,
    createdAt: new Date('2026-09-01'),
    category: { id: 101, name: '과자', parentId: 1 },
    wishlistCount: 0,
  };
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

describe('상품 목록 커서 방식 (searchProducts + cursor)', () => {
  const baseParams = {
    organizationId: ORGANIZATION_ID,
    sort: 'latest' as const,
    page: 1,
    limit: 2,
  };

  test('오프셋 응답에도 다음 페이지용 커서를 준다', async () => {
    repository.findMany.mockResolvedValue([[listItem(5), listItem(4)], 5]);

    const result = await productService.searchProducts(baseParams);

    expect(result.nextCursor).toBe(encodeProductCursor('latest', listItem(4)));
  });

  test('커서가 있으면 page를 무시하고 limit보다 하나 더 읽는다', async () => {
    repository.findMany.mockResolvedValue([[], 5]);
    const cursor = encodeProductCursor('latest', listItem(4));

    await productService.searchProducts({ ...baseParams, page: 9, cursor });

    const params = repository.findMany.mock.calls[0][0];
    expect(params).toMatchObject({
      take: 3,
      cursor: { sort: 'latest', id: 4 },
    });
    expect(params.skip).toBeUndefined();
  });

  test('한 개 더 읽혔으면 잘라내고 마지막 상품으로 다음 커서를 만든다', async () => {
    repository.findMany.mockResolvedValue([
      [listItem(3), listItem(2), listItem(1)],
      5,
    ]);
    const cursor = encodeProductCursor('latest', listItem(4));

    const result = await productService.searchProducts({
      ...baseParams,
      cursor,
    });

    expect(result.products.map((product) => product.id)).toEqual([3, 2]);
    expect(result).toMatchObject({ hasNext: true, totalCount: 5 });
    expect(result.nextCursor).toBe(encodeProductCursor('latest', listItem(2)));
    expect(result).not.toHaveProperty('page');
  });

  test('마지막 묶음이면 hasNext가 false이고 nextCursor는 null이다', async () => {
    repository.findMany.mockResolvedValue([[listItem(1)], 5]);
    const cursor = encodeProductCursor('latest', listItem(2));

    const result = await productService.searchProducts({
      ...baseParams,
      cursor,
    });

    expect(result).toMatchObject({ hasNext: false, nextCursor: null });
  });

  test('정렬과 맞지 않는 커서는 조회 전에 400을 던진다', async () => {
    const cursor = encodeProductCursor('latest', listItem(4));

    const promise = productService.searchProducts({
      ...baseParams,
      sort: 'popular',
      cursor,
    });

    await expect(promise).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.findMany).not.toHaveBeenCalled();
  });
});

describe('검색 결과가 없을 때 상품명 추천', () => {
  const baseParams = {
    organizationId: ORGANIZATION_ID,
    sort: 'latest' as const,
    page: 1,
    limit: 10,
  };

  test('키워드 검색 결과가 0건이면 같은 범위에서 비슷한 상품명을 추천한다', async () => {
    repository.findMany.mockResolvedValue([[], 0]);
    repository.findSimilarNames.mockResolvedValue(['새우깡']);

    const result = await productService.searchProducts({
      ...baseParams,
      createdById: OWNER_ID,
      keyword: '새우강',
    });

    expect(result.suggestions).toEqual(['새우깡']);
    expect(repository.findSimilarNames).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      createdById: OWNER_ID,
      keyword: '새우강',
      take: 5,
    });
  });

  test('결과가 있으면 추천 쿼리를 하지 않는다', async () => {
    repository.findMany.mockResolvedValue([[listItem(1)], 1]);

    const result = await productService.searchProducts({
      ...baseParams,
      keyword: '새우깡',
    });

    expect(result.suggestions).toEqual([]);
    expect(repository.findSimilarNames).not.toHaveBeenCalled();
  });

  test('키워드 없이 0건이면 추천하지 않는다', async () => {
    repository.findMany.mockResolvedValue([[], 0]);

    const result = await productService.searchProducts(baseParams);

    expect(result.suggestions).toEqual([]);
    expect(repository.findSimilarNames).not.toHaveBeenCalled();
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
    expect(invalidateProductListCache).toHaveBeenCalledWith(ORGANIZATION_ID);
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
    expect(invalidateProductListCache).toHaveBeenCalledWith(ORGANIZATION_ID);
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
      expect(invalidateProductListCache).toHaveBeenCalledWith(ORGANIZATION_ID);
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
    expect(invalidateProductListCache).not.toHaveBeenCalled();
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
