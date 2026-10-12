import {
  bumpCacheVersion,
  getOrSetCache,
  readCacheVersion,
} from '../../utils/cache';
import type { ProductSort } from './product.schema';

/*
@ 상품 목록 캐시
- 대상: 조직 전체 상품의 첫 화면(키워드·등록자·커서 없이 page=1).
  홈과 카테고리 탭에서 가장 많이 부르고 결과가 같은 요청이다.
  검색어는 조합이 많아 적중률이 낮고, 내 상품 목록은 사용자마다 달라 담지 않는다.
- 무효화: 조직별 버전 키를 올린다. 캐시 키에 버전이 들어 있어 이전 키는 더 이상 읽히지 않는다.
  상품 등록·수정·삭제, 찜 추가·삭제(wishlistCount), 구매 승인(purchaseCount) 뒤에 부른다.
- TTL: 무효화 호출이 Redis 장애로 실패해도 옛 값이 오래 남지 않게 짧게 둔다.
*/

const LIST_TTL_SECONDS = 60;

type ListCacheParams = {
  organizationId: number;
  createdById?: number;
  keyword?: string;
  categoryId?: number;
  parentCategoryId?: number;
  sort: ProductSort;
  cursor?: string;
  page: number;
  limit: number;
};

function versionKey(organizationId: number): string {
  return `products:list:version:org:${organizationId}`;
}

export function isCacheableListQuery(params: ListCacheParams): boolean {
  return (
    !params.keyword &&
    !params.createdById &&
    !params.cursor &&
    params.page === 1
  );
}

export async function getCachedProductList<T>(
  params: ListCacheParams,
  load: () => Promise<T>,
): Promise<T> {
  if (!isCacheableListQuery(params)) return load();

  const { organizationId, sort, categoryId, parentCategoryId, limit } = params;
  const version = await readCacheVersion(versionKey(organizationId));

  if (version === null) return load();

  const key = [
    'products:list',
    `org:${organizationId}`,
    `v:${version}`,
    `sort:${sort}`,
    `cat:${categoryId ?? '-'}`,
    `parent:${parentCategoryId ?? '-'}`,
    `limit:${limit}`,
  ].join(':');

  return getOrSetCache(key, LIST_TTL_SECONDS, load);
}

export function invalidateProductListCache(
  organizationId: number,
): Promise<void> {
  return bumpCacheVersion(versionKey(organizationId));
}
