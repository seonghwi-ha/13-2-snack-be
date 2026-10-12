import type { Prisma } from '../../generated/prisma/client';

/*
@ 상품 변경 이력 내용 만들기
- 이력에 남기는 필드는 사용자가 등록·수정 화면에서 바꿀 수 있는 값으로 한정한다.
  구매 수(purchaseCount)처럼 시스템이 바꾸는 값은 남기지 않는다.
*/

export const TRACKED_PRODUCT_FIELDS = [
  'name',
  'price',
  'categoryId',
  'imageUrl',
  'productUrl',
] as const;

type TrackedField = (typeof TRACKED_PRODUCT_FIELDS)[number];

export type TrackedProductValues = {
  [Field in TrackedField]: Field extends 'name'
    ? string
    : Field extends 'price' | 'categoryId'
      ? number
      : string | null;
};

type FieldValue = string | number | null;
type FieldChange = { before: FieldValue; after: FieldValue };

export type ProductChanges = Partial<Record<TrackedField, FieldChange>>;

// 등록 이력에는 등록 시점 값을 남긴다. 선택 항목을 안 보냈으면 null로 둔다.
export function toCreateSnapshot(
  data: Partial<TrackedProductValues> &
    Pick<TrackedProductValues, 'name' | 'price' | 'categoryId'>,
): Prisma.InputJsonObject {
  return {
    name: data.name,
    price: data.price,
    categoryId: data.categoryId,
    imageUrl: data.imageUrl ?? null,
    productUrl: data.productUrl ?? null,
  };
}

/**
 * 수정 요청 중 실제로 값이 바뀐 필드만 { before, after }로 돌려준다.
 * 같은 값을 다시 보낸 필드는 빠지므로, 결과가 비어 있으면 이력을 남기지 않는다.
 */
export function diffProduct(
  before: TrackedProductValues,
  data: Partial<TrackedProductValues>,
): ProductChanges {
  const changes: ProductChanges = {};

  for (const field of TRACKED_PRODUCT_FIELDS) {
    const after = data[field];

    // undefined는 "보내지 않음"이라 바꾸지 않은 것이다. null은 값을 비운 것이라 변경이다.
    if (after === undefined || after === before[field]) continue;

    changes[field] = { before: before[field], after };
  }

  return changes;
}
