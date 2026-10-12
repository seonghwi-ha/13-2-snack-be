import { Prisma } from '../../generated/prisma/client';
import { BadRequestError } from '../../types/errors';
import type { ProductSort } from './product.schema';

/*
@ 상품 목록 커서
- 오프셋(skip)은 뒤 페이지로 갈수록 앞의 행을 모두 읽고 버려서 느려지고,
  스크롤 중에 상품이 추가·삭제되면 같은 상품이 중복되거나 빠진다.
- 커서는 "마지막으로 본 상품의 정렬 값과 id"를 담아, 그 다음 행부터 읽는다.
- 정렬마다 기준 컬럼이 달라 커서에 정렬 이름도 넣고, 요청 정렬과 다르면 거부한다.
- 프론트가 내용을 해석하지 않도록 base64url로 감싼 불투명한 문자열로 내려준다.
*/

export type ProductCursor = {
  sort: ProductSort;
  // latest는 createdAt(ISO 문자열), 나머지는 숫자
  value: string | number;
  id: number;
};

type CursorSource = {
  id: number;
  createdAt: Date;
  purchaseCount: number;
  price: number;
};

export function encodeProductCursor(
  sort: ProductSort,
  product: CursorSource,
): string {
  const value =
    sort === 'latest'
      ? product.createdAt.toISOString()
      : sort === 'popular'
        ? product.purchaseCount
        : product.price;

  const cursor: ProductCursor = { sort, value, id: product.id };

  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function isValidCursor(value: unknown, sort: ProductSort): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const cursor = value as Record<string, unknown>;

  if (cursor.sort !== sort) return false;
  if (!Number.isInteger(cursor.id) || (cursor.id as number) < 1) return false;

  if (sort === 'latest') {
    return (
      typeof cursor.value === 'string' &&
      !Number.isNaN(Date.parse(cursor.value))
    );
  }

  return Number.isInteger(cursor.value);
}

export function decodeProductCursor(
  encoded: string,
  sort: ProductSort,
): ProductCursor {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestError('올바르지 않은 커서입니다.', 'INVALID_CURSOR');
  }

  // 정렬을 바꾸면 이전 커서는 의미가 없으므로 첫 페이지부터 다시 요청해야 한다.
  if (!isValidCursor(parsed, sort)) {
    throw new BadRequestError('올바르지 않은 커서입니다.', 'INVALID_CURSOR');
  }

  return parsed as ProductCursor;
}

/**
 * 커서 다음 행을 고르는 조건. repository의 ORDER_BY와 방향을 맞춰야 한다.
 * 모든 정렬이 마지막 키로 id 내림차순을 쓰므로, 정렬 값이 같으면 id가 더 작은 쪽이 다음이다.
 */
export function buildCursorWhere(
  cursor: ProductCursor,
): Prisma.ProductWhereInput {
  const { sort, value, id } = cursor;

  if (sort === 'latest') {
    const createdAt = new Date(value);

    return {
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
    };
  }

  const amount = value as number;

  if (sort === 'popular') {
    return {
      OR: [
        { purchaseCount: { lt: amount } },
        { purchaseCount: amount, id: { lt: id } },
      ],
    };
  }

  if (sort === 'priceAsc') {
    return {
      OR: [{ price: { gt: amount } }, { price: amount, id: { lt: id } }],
    };
  }

  return {
    OR: [{ price: { lt: amount } }, { price: amount, id: { lt: id } }],
  };
}
