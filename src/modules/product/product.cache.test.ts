import { getOrSetCache, readCacheVersion } from '../../utils/cache';
import { getCachedProductList, isCacheableListQuery } from './product.cache';

jest.mock('../../utils/cache');

const cache = {
  getOrSet: jest.mocked(getOrSetCache),
  readVersion: jest.mocked(readCacheVersion),
};

const firstScreen = {
  organizationId: 1,
  sort: 'popular' as const,
  page: 1,
  limit: 10,
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('상품 목록 캐시 대상 (isCacheableListQuery)', () => {
  test('조직 전체 첫 화면은 담는다 (카테고리 필터 포함)', () => {
    expect(isCacheableListQuery(firstScreen)).toBe(true);
    expect(isCacheableListQuery({ ...firstScreen, categoryId: 101 })).toBe(
      true,
    );
  });

  test.each([
    ['검색어', { keyword: '새우' }],
    ['내 상품', { createdById: 10 }],
    ['커서', { cursor: 'abc' }],
    ['2페이지 이후', { page: 2 }],
  ])('%s 요청은 담지 않는다', (_label, extra) => {
    expect(isCacheableListQuery({ ...firstScreen, ...extra })).toBe(false);
  });
});

describe('상품 목록 캐시 조회 (getCachedProductList)', () => {
  test('조직 버전과 조건을 키에 넣어 캐시한다', async () => {
    cache.readVersion.mockResolvedValue('7');
    cache.getOrSet.mockResolvedValue('cached');
    const load = jest.fn();

    const result = await getCachedProductList(
      { ...firstScreen, categoryId: 101 },
      load,
    );

    expect(result).toBe('cached');
    expect(cache.readVersion).toHaveBeenCalledWith(
      'products:list:version:org:1',
    );
    expect(cache.getOrSet).toHaveBeenCalledWith(
      'products:list:org:1:v:7:sort:popular:cat:101:parent:-:limit:10',
      60,
      load,
    );
  });

  test('버전을 읽지 못하면(Redis 장애·미설정) 캐시 없이 읽는다', async () => {
    cache.readVersion.mockResolvedValue(null);
    const load = jest.fn().mockResolvedValue('fresh');

    const result = await getCachedProductList(firstScreen, load);

    expect(result).toBe('fresh');
    expect(cache.getOrSet).not.toHaveBeenCalled();
  });

  test('대상이 아닌 요청은 Redis를 건드리지 않는다', async () => {
    const load = jest.fn().mockResolvedValue('fresh');

    await getCachedProductList({ ...firstScreen, keyword: '새우' }, load);

    expect(cache.readVersion).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
