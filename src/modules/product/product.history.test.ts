import { diffProduct, toCreateSnapshot } from './product.history';

const before = {
  name: '새우깡',
  price: 1500,
  categoryId: 101,
  imageUrl: '/api/images/products/a.png',
  productUrl: null,
};

describe('상품 수정 이력 내용 (diffProduct)', () => {
  test('실제로 바뀐 필드만 이전·이후 값으로 남긴다', () => {
    const changes = diffProduct(before, { name: '새우깡', price: 1800 });

    expect(changes).toEqual({ price: { before: 1500, after: 1800 } });
  });

  test('값을 비운 것(null)도 변경으로 본다', () => {
    const changes = diffProduct(before, { imageUrl: null });

    expect(changes).toEqual({
      imageUrl: { before: '/api/images/products/a.png', after: null },
    });
  });

  test('보내지 않은 필드(undefined)는 변경이 아니다', () => {
    const changes = diffProduct(before, { productUrl: undefined });

    expect(changes).toEqual({});
  });

  test('같은 값만 보내면 빈 객체라 이력을 남기지 않는다', () => {
    const changes = diffProduct(before, { ...before });

    expect(changes).toEqual({});
  });
});

describe('상품 등록 이력 내용 (toCreateSnapshot)', () => {
  test('선택 항목을 안 보냈으면 null로 채운다', () => {
    const snapshot = toCreateSnapshot({
      name: '새우깡',
      price: 1500,
      categoryId: 101,
    });

    expect(snapshot).toEqual({
      name: '새우깡',
      price: 1500,
      categoryId: 101,
      imageUrl: null,
      productUrl: null,
    });
  });
});
