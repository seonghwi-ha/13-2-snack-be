import {
  createProductSchema,
  searchProductsSchema,
  updateProductSchema,
} from './product.schema';

const validProduct = { name: '새우깡', price: 1500, categoryId: 101 };

describe('상품 등록 스키마 (createProductSchema)', () => {
  test('필수 값만 있으면 통과한다', () => {
    const result = createProductSchema.safeParse(validProduct);

    expect(result.success).toBe(true);
  });

  test('상품명 앞뒤 공백을 지운다', () => {
    const result = createProductSchema.parse({
      ...validProduct,
      name: '  새우깡  ',
    });

    expect(result.name).toBe('새우깡');
  });

  test('상품명이 없으면 필수 값 메시지를 준다', () => {
    const result = createProductSchema.safeParse({
      price: 1500,
      categoryId: 101,
    });

    expect(result.error?.issues[0]?.message).toBe('상품명은 필수 값입니다.');
  });

  test('상품명이 문자열이 아니면 타입 메시지를 준다', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      name: 123,
    });

    expect(result.error?.issues[0]?.message).toBe(
      '상품명은 문자열이어야 합니다.',
    );
  });

  test('가격은 숫자 문자열도 받는다', () => {
    const result = createProductSchema.parse({
      ...validProduct,
      price: '2000',
    });

    expect(result.price).toBe(2000);
  });

  test.each([[''], ['   '], [null]])(
    '가격이 비어 있으면(%p) 0원으로 저장하지 않고 거부한다',
    (price) => {
      const result = createProductSchema.safeParse({ ...validProduct, price });

      expect(result.error?.issues[0]?.message).toBe('가격은 필수 값입니다.');
    },
  );

  test('가격 0원은 허용한다', () => {
    const result = createProductSchema.parse({ ...validProduct, price: 0 });

    expect(result.price).toBe(0);
  });

  test('음수 가격은 거부한다', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      price: -1,
    });

    expect(result.success).toBe(false);
  });

  test('이미지 주소는 내부 이미지 API 경로를 받는다', () => {
    const result = createProductSchema.parse({
      ...validProduct,
      imageUrl: '/api/images/products/abc.png',
    });

    expect(result.imageUrl).toBe('/api/images/products/abc.png');
  });

  test('이미지 주소는 외부 URL도 받는다', () => {
    const result = createProductSchema.parse({
      ...validProduct,
      imageUrl: 'https://example.com/a.png',
    });

    expect(result.imageUrl).toBe('https://example.com/a.png');
  });

  test('이미지 주소가 경로도 URL도 아니면 거부한다', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      imageUrl: 'not-a-url',
    });

    expect(result.error?.issues[0]?.message).toBe(
      '올바른 이미지 주소가 아닙니다.',
    );
  });

  test.each([[''], ['  '], [null]])(
    '빈 이미지·링크(%p)는 null로 바꿔 비운다',
    (value) => {
      const result = createProductSchema.parse({
        ...validProduct,
        imageUrl: value,
        productUrl: value,
      });

      expect(result.imageUrl).toBeNull();
      expect(result.productUrl).toBeNull();
    },
  );

  test('제품 링크는 내부 경로를 받지 않는다', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      productUrl: '/products/1',
    });

    expect(result.error?.issues[0]?.message).toBe(
      '올바른 상품 URL이 아닙니다.',
    );
  });
});

describe('상품 수정 스키마 (updateProductSchema)', () => {
  test('일부 필드만 보내도 통과한다', () => {
    const result = updateProductSchema.parse({ price: 3000 });

    expect(result).toEqual({ price: 3000 });
  });

  test('수정할 내용이 없으면 거부한다', () => {
    const result = updateProductSchema.safeParse({});

    expect(result.error?.issues[0]?.message).toBe('수정할 내용이 없습니다.');
  });
});

describe('상품 목록 조회 스키마 (searchProductsSchema)', () => {
  test('값이 없으면 기본값을 채운다', () => {
    const result = searchProductsSchema.parse({});

    expect(result).toEqual({ sort: 'latest', page: 1, limit: 10 });
  });

  test('쿼리 문자열 숫자를 숫자로 바꾼다', () => {
    const result = searchProductsSchema.parse({
      categoryId: '101',
      page: '2',
      limit: '20',
    });

    expect(result).toMatchObject({ categoryId: 101, page: 2, limit: 20 });
  });

  test('지원하지 않는 정렬은 거부한다', () => {
    const result = searchProductsSchema.safeParse({ sort: 'random' });

    expect(result.success).toBe(false);
  });

  test('limit은 100을 넘을 수 없다', () => {
    const result = searchProductsSchema.safeParse({ limit: '101' });

    expect(result.error?.issues[0]?.message).toBe(
      'limit은 100 이하여야 합니다.',
    );
  });

  test('page는 1 이상이어야 한다', () => {
    const result = searchProductsSchema.safeParse({ page: '0' });

    expect(result.error?.issues[0]?.message).toBe(
      'page는 1 이상이어야 합니다.',
    );
  });
});
