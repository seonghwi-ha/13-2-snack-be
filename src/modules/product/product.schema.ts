import { z } from 'zod';

export const PRODUCT_SORTS = [
  'latest',
  'popular',
  'priceAsc',
  'priceDesc',
] as const;

export type ProductSort = (typeof PRODUCT_SORTS)[number];

// 숫자 변환은 null·빈 문자열·배열을 0으로 만들어 버린다.
// 값이 없는 것과 0을 구분하려고, 숫자나 빈칸이 아닌 문자열만 통과시킨다.
function numberInput(value: unknown): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return value;

  return undefined;
}

// 수정 모달에서 이미지·링크를 지울 수 있어야 해서 null과 빈 문자열도 받고, null로 통일해 저장한다.
function nullableUrlSchema(message: string) {
  return z
    .preprocess(
      (value) => (typeof value === 'string' ? value.trim() : value),
      z.union([z.literal(''), z.null(), z.url({ error: message })]),
    )
    .transform((value) => (value === '' ? null : value));
}

// 업로드한 이미지는 우리 이미지 API 경로(`/api/images/...`)로 오고 외부 URL이 아니다.
// 외부 이미지 주소도 아직 허용해야 해서 절대 URL과 내부 경로를 둘 다 받는다.
// 문자열 후보가 둘이라 둘 다 실패하면 Zod가 "Invalid input"으로 뭉뚱그리므로
// union 자체에도 메시지를 준다.
function nullableImageUrlSchema(message: string) {
  return z
    .preprocess(
      (value) => (typeof value === 'string' ? value.trim() : value),
      z.union(
        [
          z.literal(''),
          z.null(),
          z.string().regex(/^\/[^\s]*$/, { error: message }),
          z.url({ error: message }),
        ],
        { error: message },
      ),
    )
    .transform((value) => (value === '' ? null : value));
}

export const productIdParamsSchema = z.object({
  id: z.coerce
    .number({ error: '올바른 상품 ID가 아닙니다.' })
    .int({ error: '올바른 상품 ID가 아닙니다.' })
    .positive({ error: '올바른 상품 ID가 아닙니다.' }),
});

export const searchProductsSchema = z.object({
  keyword: z.string().trim().optional(),

  // 소분류 ID. 그 소분류 상품만 조회한다.
  categoryId: z.coerce
    .number({ error: 'categoryId는 숫자여야 합니다.' })
    .int({ error: 'categoryId는 정수여야 합니다.' })
    .positive({ error: 'categoryId는 1 이상이어야 합니다.' })
    .optional(),

  // 대분류 ID. 그 아래 소분류 상품을 모두 조회한다.
  parentCategoryId: z.coerce
    .number({ error: 'parentCategoryId는 숫자여야 합니다.' })
    .int({ error: 'parentCategoryId는 정수여야 합니다.' })
    .positive({ error: 'parentCategoryId는 1 이상이어야 합니다.' })
    .optional(),

  sort: z
    .enum(PRODUCT_SORTS, {
      error: '정렬 조건은 latest, popular, priceAsc, priceDesc만 가능합니다.',
    })
    .default('latest'),

  page: z.coerce
    .number({ error: 'page는 숫자여야 합니다.' })
    .int({ error: 'page는 정수여야 합니다.' })
    .min(1, { error: 'page는 1 이상이어야 합니다.' })
    .default(1),

  limit: z.coerce
    .number({ error: 'limit은 숫자여야 합니다.' })
    .int({ error: 'limit은 정수여야 합니다.' })
    .min(1, { error: 'limit은 1 이상이어야 합니다.' })
    .max(100, { error: 'limit은 100 이하여야 합니다.' })
    .default(10),
});

export const createProductSchema = z.object(
  {
    name: z
      .string({
        error: (issue) =>
          issue.input === undefined
            ? '상품명은 필수 값입니다.'
            : '상품명은 문자열이어야 합니다.',
      })
      .trim()
      .min(1, { error: '상품명은 1자 이상이어야 합니다.' })
      .max(100, { error: '상품명은 100자 이하여야 합니다.' }),

    // 원 단위 정수로 저장한다.
    price: z.preprocess(
      numberInput,
      z.coerce
        .number({ error: '가격은 필수 값입니다.' })
        .int({ error: '가격은 정수여야 합니다.' })
        .min(0, { error: '가격은 0 이상이어야 합니다.' })
        .max(100_000_000, { error: '가격은 1억 이하여야 합니다.' }),
    ),

    categoryId: z.coerce
      .number({ error: '카테고리는 필수 값입니다.' })
      .int({ error: '올바른 카테고리 ID가 아닙니다.' })
      .positive({ error: '올바른 카테고리 ID가 아닙니다.' }),

    imageUrl:
      nullableImageUrlSchema('올바른 이미지 주소가 아닙니다.').optional(),

    // 관리자가 실제 구매할 외부 판매처 링크
    productUrl: nullableUrlSchema('올바른 상품 URL이 아닙니다.').optional(),
  },
  { error: '요청 본문이 올바르지 않습니다.' },
);

export const updateProductSchema = createProductSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    error: '수정할 내용이 없습니다.',
  });

export type SearchProductsInput = z.infer<typeof searchProductsSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
