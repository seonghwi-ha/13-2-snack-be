import { BadRequestError } from '../../types/errors';
import {
  buildCursorWhere,
  decodeProductCursor,
  encodeProductCursor,
} from './product.cursor';

const product = {
  id: 42,
  createdAt: new Date('2026-09-01T12:34:56.789Z'),
  purchaseCount: 7,
  price: 1500,
};

function encodeRaw(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('상품 커서 인코딩·디코딩', () => {
  test.each([
    ['latest', '2026-09-01T12:34:56.789Z'],
    ['popular', 7],
    ['priceAsc', 1500],
    ['priceDesc', 1500],
  ] as const)('%s 정렬은 정렬 값과 id를 담는다', (sort, value) => {
    const encoded = encodeProductCursor(sort, product);

    expect(decodeProductCursor(encoded, sort)).toEqual({
      sort,
      value,
      id: 42,
    });
  });

  test('URL에 그대로 쓸 수 있는 문자만 쓴다', () => {
    const encoded = encodeProductCursor('latest', product);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('정렬이 바뀌면 이전 커서를 거부한다', () => {
    const encoded = encodeProductCursor('latest', product);

    expect(() => decodeProductCursor(encoded, 'popular')).toThrow(
      BadRequestError,
    );
  });

  test.each([
    ['base64가 아닌 값', '!!!'],
    ['JSON이 아닌 값', Buffer.from('hello').toString('base64url')],
    ['id가 없는 값', encodeRaw({ sort: 'popular', value: 1 })],
    ['id가 음수인 값', encodeRaw({ sort: 'popular', value: 1, id: -1 })],
    ['날짜가 아닌 값', encodeRaw({ sort: 'latest', value: 'abc', id: 1 })],
    ['숫자가 아닌 값', encodeRaw({ sort: 'priceAsc', value: '1', id: 1 })],
  ])('%s은 400 INVALID_CURSOR로 거부한다', (_label, encoded) => {
    expect(() => decodeProductCursor(encoded, 'latest')).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'INVALID_CURSOR' }),
    );
  });
});

describe('커서 다음 행 조건 (buildCursorWhere)', () => {
  test('최신순은 더 이전에 등록됐거나, 같은 시각이면 id가 더 작은 상품', () => {
    const where = buildCursorWhere({
      sort: 'latest',
      value: '2026-09-01T00:00:00.000Z',
      id: 42,
    });

    const createdAt = new Date('2026-09-01T00:00:00.000Z');
    expect(where).toEqual({
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: 42 } }],
    });
  });

  test('낮은 가격순은 가격이 더 높거나, 같으면 id가 더 작은 상품', () => {
    const where = buildCursorWhere({ sort: 'priceAsc', value: 1500, id: 42 });

    expect(where).toEqual({
      OR: [{ price: { gt: 1500 } }, { price: 1500, id: { lt: 42 } }],
    });
  });

  test('높은 가격순은 가격이 더 낮거나, 같으면 id가 더 작은 상품', () => {
    const where = buildCursorWhere({ sort: 'priceDesc', value: 1500, id: 42 });

    expect(where).toEqual({
      OR: [{ price: { lt: 1500 } }, { price: 1500, id: { lt: 42 } }],
    });
  });

  test('인기순은 구매 수가 더 적거나, 같으면 id가 더 작은 상품', () => {
    const where = buildCursorWhere({ sort: 'popular', value: 7, id: 42 });

    expect(where).toEqual({
      OR: [{ purchaseCount: { lt: 7 } }, { purchaseCount: 7, id: { lt: 42 } }],
    });
  });
});
