import { prisma } from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';
import { type ProductCursor, buildCursorWhere } from './product.cursor';
import type { ProductSort } from './product.schema';

type FindManyParams = {
  organizationId: number;
  // 상품 등록 내역(GET /me/products)에서 등록자로 거를 때만 넣는다.
  createdById?: number;
  keyword?: string;
  categoryId?: number;
  parentCategoryId?: number;
  sort: ProductSort;
  // 오프셋 방식은 skip, 커서 방식은 cursor를 넣는다. 둘 다 없으면 처음부터 읽는다.
  skip?: number;
  cursor?: ProductCursor;
  take: number;
};

type CreateData = {
  name: string;
  price: number;
  categoryId: number;
  createdById: number;
  organizationId: number;
  // null은 값을 비운다는 뜻이다.
  imageUrl?: string | null;
  productUrl?: string | null;
};

// 등록자와 소속 조직은 등록 시점에 정해지고 수정으로 바꿀 수 없다.
type UpdateData = Partial<Omit<CreateData, 'createdById' | 'organizationId'>>;

// 찜한 사람 수. 상품 카드와 상세에 좋아요 개수로 보여준다.
// WishlistItem은 (userId, productId) 유일이라 행 수가 곧 사람 수다.
const wishlistCountSelect = {
  _count: { select: { wishlistItems: true } },
} satisfies Prisma.ProductSelect;

const productListArgs = {
  select: {
    id: true,
    name: true,
    price: true,
    imageUrl: true,
    // 상품 등록 내역 화면이 "제품 링크" 열에 그대로 쓴다.
    productUrl: true,
    purchaseCount: true,
    createdAt: true,
    category: { select: { id: true, name: true, parentId: true } },
    ...wishlistCountSelect,
  },
} satisfies Prisma.ProductDefaultArgs;

type ProductListRow = Prisma.ProductGetPayload<typeof productListArgs>;

const productDetailArgs = {
  select: {
    id: true,
    name: true,
    price: true,
    imageUrl: true,
    productUrl: true,
    purchaseCount: true,
    createdAt: true,
    updatedAt: true,
    category: { select: { id: true, name: true, parentId: true } },
    createdBy: { select: { id: true, name: true } },
    ...wishlistCountSelect,
  },
} satisfies Prisma.ProductDefaultArgs;

type ProductDetailRow = Prisma.ProductGetPayload<typeof productDetailArgs>;

// `_count.wishlistItems`는 응답에 그대로 두기 어색해서 wishlistCount로 펴서 내보낸다.
export type ProductListItem = Omit<ProductListRow, '_count'> & {
  wishlistCount: number;
};

export type ProductDetail = Omit<ProductDetailRow, '_count'> & {
  wishlistCount: number;
};

function toListItem({ _count, ...product }: ProductListRow): ProductListItem {
  return { ...product, wishlistCount: _count.wishlistItems };
}

function toDetail({ _count, ...product }: ProductDetailRow): ProductDetail {
  return { ...product, wishlistCount: _count.wishlistItems };
}

const productOwnerArgs = {
  select: { id: true, createdById: true },
} satisfies Prisma.ProductDefaultArgs;

export type ProductOwner = Prisma.ProductGetPayload<
  typeof productOwnerArgs
> | null;

// id를 마지막 정렬 키로 둔다. 정렬 값이 같을 때 순서가 흔들리면
// 무한 스크롤에서 같은 상품이 중복되거나 누락된다.
const ORDER_BY: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> =
  {
    latest: [{ createdAt: 'desc' }, { id: 'desc' }],
    popular: [{ purchaseCount: 'desc' }, { id: 'desc' }],
    priceAsc: [{ price: 'asc' }, { id: 'desc' }],
    priceDesc: [{ price: 'desc' }, { id: 'desc' }],
  };

// 회사별로 거른다. categoryId는 소분류 하나, parentCategoryId는 그 대분류 아래 전체를 뜻한다.
function buildWhere({
  organizationId,
  createdById,
  keyword,
  categoryId,
  parentCategoryId,
}: Pick<
  FindManyParams,
  | 'organizationId'
  | 'createdById'
  | 'keyword'
  | 'categoryId'
  | 'parentCategoryId'
>): Prisma.ProductWhereInput {
  return {
    isDeleted: false,
    organizationId,
    ...(createdById ? { createdById } : {}),
    ...(keyword
      ? { name: { contains: keyword, mode: Prisma.QueryMode.insensitive } }
      : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(parentCategoryId ? { category: { parentId: parentCategoryId } } : {}),
  };
}

export async function findMany({
  organizationId,
  createdById,
  keyword,
  categoryId,
  parentCategoryId,
  sort,
  skip,
  cursor,
  take,
}: FindManyParams): Promise<[ProductListItem[], number]> {
  const where = buildWhere({
    organizationId,
    createdById,
    keyword,
    categoryId,
    parentCategoryId,
  });

  // totalCount는 커서 위치와 상관없이 조건에 맞는 전체 개수다.
  const [rows, totalCount] = await Promise.all([
    prisma.product.findMany({
      where: cursor ? { AND: [where, buildCursorWhere(cursor)] } : where,
      select: productListArgs.select,
      orderBy: ORDER_BY[sort],
      skip,
      take,
    }),
    prisma.product.count({ where }),
  ]);

  return [rows.map(toListItem), totalCount];
}

export async function findDetailById(
  productId: number,
  organizationId: number,
): Promise<ProductDetail | null> {
  const product = await prisma.product.findFirst({
    where: { id: productId, isDeleted: false, organizationId },
    select: productDetailArgs.select,
  });

  return product && toDetail(product);
}

export function findOwnerById(
  productId: number,
  organizationId: number,
): Promise<ProductOwner> {
  return prisma.product.findFirst({
    where: { id: productId, isDeleted: false, organizationId },
    select: productOwnerArgs.select,
  });
}

// 카테고리는 별도 모듈이 없어 존재 확인만 여기에 둔다. 카테고리 도메인이 생기면 옮긴다.
export function findCategoryById(
  categoryId: number,
): Promise<{ id: number } | null> {
  return prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
}

export async function create(data: CreateData): Promise<ProductDetail> {
  const product = await prisma.product.create({
    data,
    select: productDetailArgs.select,
  });

  return toDetail(product);
}

export async function update(
  productId: number,
  data: UpdateData,
): Promise<ProductDetail> {
  const product = await prisma.product.update({
    where: { id: productId },
    data,
    select: productDetailArgs.select,
  });

  return toDetail(product);
}

export function softDelete(productId: number): Promise<{ id: number }> {
  return prisma.product.update({
    where: { id: productId },
    data: { isDeleted: true },
    select: { id: true },
  });
}

// 오타 추천 기준. 한글 상품명은 짧아서 pg_trgm 기본값(0.6)이면 한 글자 오타도 놓친다.
// 예) '새우강' ↔ '새우깡' = 0.5, '코가콜라' ↔ '코카콜라 500ml' = 0.25
const SIMILAR_NAME_MIN_SCORE = 0.25;
// 기준을 낮춘 만큼 엉뚱한 이름이 섞이므로 가장 비슷한 이름 점수의 80% 이상만 남긴다.
// 예) '포카침' → '오리온 포카칩'(0.5)은 남고 '3M 포스트잇'(0.25)은 빠진다.
const SIMILAR_NAME_RELATIVE_SCORE = 0.8;

type FindSimilarNamesParams = {
  organizationId: number;
  createdById?: number;
  keyword: string;
  take: number;
};

/**
 * 키워드와 비슷한 상품명을 유사도 높은 순으로 돌려준다. 검색 결과가 없을 때만 부른다.
 * word_similarity는 키워드가 상품명의 일부와 얼마나 닮았는지를 0~1로 잰다.
 * 임계값을 함수로 직접 비교해서 트라이그램 인덱스를 타지 않으므로, 결과가 0건일 때만 쓴다.
 */
export async function findSimilarNames({
  organizationId,
  createdById,
  keyword,
  take,
}: FindSimilarNamesParams): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ name: string; score: number }[]>`
    SELECT "name", MAX(word_similarity(${keyword}, "name")) AS "score"
    FROM "Product"
    WHERE "organizationId" = ${organizationId}
      AND "isDeleted" = false
      ${createdById ? Prisma.sql`AND "createdById" = ${createdById}` : Prisma.empty}
      AND word_similarity(${keyword}, "name") >= ${SIMILAR_NAME_MIN_SCORE}
    GROUP BY "name"
    ORDER BY "score" DESC, "name" ASC
    LIMIT ${take}
  `;

  const topScore = rows[0]?.score ?? 0;

  return rows
    .filter((row) => row.score >= topScore * SIMILAR_NAME_RELATIVE_SCORE)
    .map((row) => row.name);
}
