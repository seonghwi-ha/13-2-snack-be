import { Role } from '../../generated/prisma/client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../types/errors';
import { decodeProductCursor, encodeProductCursor } from './product.cursor';
import * as productRepository from './product.repository';
import type { ProductDetail, ProductListItem } from './product.repository';
import type {
  CreateProductInput,
  SearchProductsInput,
  UpdateProductInput,
} from './product.schema';

// 컨트롤러가 넘기는 req.auth 중 권한 판단에 쓰는 값만 받는다.
type Requester = {
  userId: number;
  role: Role;
  organizationId: number;
};

type SearchProductsParams = SearchProductsInput & {
  organizationId: number;
  // 상품 등록 내역에서만 넣는다. 없으면 회사 전체 상품을 본다.
  createdById?: number;
};

/**
 * 상세 응답에 요청자가 등록자인지(`isMine`)를 붙인다.
 * 프론트가 수정·삭제 메뉴를 "본인 또는 ADMIN 이상"에만 보여주는데,
 * 로그인 사용자 조회(GET /me)가 id를 주지 않아 본인 여부를 알 수 없어서 여기서 알려준다.
 */
type ProductDetailWithOwnership = ProductDetail & { isMine: boolean };

function withOwnership(
  product: ProductDetail,
  userId: number,
): ProductDetailWithOwnership {
  return { ...product, isMine: product.createdBy.id === userId };
}

type SearchProductsResult = {
  products: ProductListItem[];
  limit: number;
  totalCount: number;
  /** 상품 리스트가 무한 스크롤이라 다음 페이지를 요청할지 이 값으로 판단한다. */
  hasNext: boolean;
  /** 다음 요청의 cursor로 그대로 보낸다. 다음 페이지가 없으면 null. */
  nextCursor: string | null;
  // 오프셋 방식(page) 응답에만 있다. 커서 방식에서는 위치를 페이지 번호로 말할 수 없다.
  page?: number;
  totalPages?: number;
};

type CreateProductParams = CreateProductInput & {
  requester: Requester;
};

type UpdateProductParams = {
  productId: number;
  requester: Requester;
  data: UpdateProductInput;
};

type DeleteProductParams = {
  productId: number;
  requester: Requester;
};

// 없는 카테고리 id는 Prisma P2003이 되어 errorHandler가 일반 메시지의 400으로 응답한다.
// 어떤 값이 잘못됐는지 알려주려고 미리 확인한다.
async function assertCategoryExists(categoryId: number): Promise<void> {
  const category = await productRepository.findCategoryById(categoryId);

  if (!category) {
    throw new BadRequestError('존재하지 않는 카테고리입니다.');
  }
}

// 수정과 삭제는 등록자 본인 또는 관리자 이상만 할 수 있다.
async function assertCanModify(
  productId: number,
  requester: Requester,
): Promise<void> {
  const product = await productRepository.findOwnerById(
    productId,
    requester.organizationId,
  );

  if (!product) {
    throw new NotFoundError('상품을 찾을 수 없습니다.');
  }

  const isOwner = product.createdById === requester.userId;
  const isAdmin =
    requester.role === Role.ADMIN || requester.role === Role.SUPER_ADMIN;

  if (!isOwner && !isAdmin) {
    throw new ForbiddenError(
      '본인이 등록한 상품만 수정하거나 삭제할 수 있습니다.',
    );
  }
}

export async function searchProducts({
  organizationId,
  createdById,
  keyword,
  categoryId,
  parentCategoryId,
  sort,
  cursor,
  page,
  limit,
}: SearchProductsParams): Promise<SearchProductsResult> {
  const filters = {
    organizationId,
    createdById,
    keyword,
    categoryId,
    parentCategoryId,
    sort,
  };

  // 커서 방식: 한 개 더 읽어서 다음 페이지가 있는지 판단한다.
  if (cursor) {
    const [rows, totalCount] = await productRepository.findMany({
      ...filters,
      cursor: decodeProductCursor(cursor, sort),
      take: limit + 1,
    });

    const hasNext = rows.length > limit;
    const products = rows.slice(0, limit);

    return {
      products,
      limit,
      totalCount,
      hasNext,
      nextCursor: hasNext
        ? encodeProductCursor(sort, products[products.length - 1])
        : null,
    };
  }

  const [products, totalCount] = await productRepository.findMany({
    ...filters,
    skip: (page - 1) * limit,
    take: limit,
  });

  // totalPages는 팀의 user 목록 API와 응답 형태를 맞추려고 그대로 둔다.
  const totalPages = Math.ceil(totalCount / limit);

  // 마지막 페이지를 넘는 요청은 400. 결과가 0건이어도 1페이지는 빈 목록으로 응답한다.
  const lastPage = Math.max(totalPages, 1);

  if (page > lastPage) {
    throw new BadRequestError(`page는 ${lastPage} 이하여야 합니다.`);
  }

  const hasNext = page < totalPages;

  return {
    products,
    page,
    limit,
    totalCount,
    totalPages,
    hasNext,
    // 첫 페이지는 page로 받고 이어서 커서로 넘어갈 수 있게 오프셋 응답에도 넣는다.
    nextCursor:
      hasNext && products.length > 0
        ? encodeProductCursor(sort, products[products.length - 1])
        : null,
  };
}

export async function getProduct(
  productId: number,
  requester: Requester,
): Promise<ProductDetailWithOwnership> {
  const product = await productRepository.findDetailById(
    productId,
    requester.organizationId,
  );

  if (!product) {
    throw new NotFoundError('상품을 찾을 수 없습니다.');
  }

  return withOwnership(product, requester.userId);
}

export async function createProduct({
  requester,
  categoryId,
  ...data
}: CreateProductParams): Promise<ProductDetailWithOwnership> {
  await assertCategoryExists(categoryId);

  const product = await productRepository.create({
    ...data,
    categoryId,
    createdById: requester.userId,
    // 조직은 body로 받지 않는다. 받으면 다른 회사에 상품을 등록할 수 있다.
    organizationId: requester.organizationId,
  });

  return withOwnership(product, requester.userId);
}

export async function updateProduct({
  productId,
  requester,
  data,
}: UpdateProductParams): Promise<ProductDetailWithOwnership> {
  await assertCanModify(productId, requester);

  if (data.categoryId !== undefined) {
    await assertCategoryExists(data.categoryId);
  }

  const product = await productRepository.update(productId, data);

  return withOwnership(product, requester.userId);
}

export async function deleteProduct({
  productId,
  requester,
}: DeleteProductParams): Promise<{ id: number }> {
  await assertCanModify(productId, requester);

  return productRepository.softDelete(productId);
}
