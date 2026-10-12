import type Redis from 'ioredis';

import { getRedisClient } from '../config/redis';

/*
@ 캐시 도우미 (cache-aside)
- 모든 함수는 Redis가 없거나 실패해도 에러를 던지지 않는다.
  캐시 실패는 "캐시 미스"로 보고 원래 데이터 소스에서 읽는다.
- 값은 JSON으로 저장한다. JSON에는 Date가 없어서 `...At`으로 끝나는 ISO 문자열은 Date로 되살린다.
*/

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reviveDates(key: string, value: unknown): unknown {
  if (key.endsWith('At') && typeof value === 'string' && ISO_DATE.test(value)) {
    return new Date(value);
  }

  return value;
}

// 연결이 끊긴 동안의 실패는 config/redis.ts가 연결 오류로 한 번만 남기므로 요청마다 찍지 않는다.
function logCacheError(
  redis: Redis,
  action: string,
  key: string,
  error: unknown,
): void {
  if (redis.status !== 'ready') return;

  const message = error instanceof Error ? error.message : String(error);
  console.error(`캐시 ${action} 실패 (${key}): ${message}`);
}

/**
 * 버전 키 값을 읽는다. 아직 없으면 '0'.
 * Redis를 쓸 수 없으면 null을 돌려주며, 이때는 캐시를 건너뛰어야 한다.
 * (버전을 모르는 채로 캐시를 읽으면 무효화된 옛 값을 줄 수 있다)
 */
export async function readCacheVersion(key: string): Promise<string | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    return (await redis.get(key)) ?? '0';
  } catch (error) {
    logCacheError(redis, '버전 조회', key, error);
    return null;
  }
}

/**
 * 버전을 올려 이 버전을 키에 담은 캐시를 한 번에 무효화한다.
 * 패턴으로 키를 찾아 지우는 것(SCAN/KEYS)보다 싸고, 옛 키는 TTL로 사라진다.
 * DB 변경이 커밋된 뒤에 불러야 다른 요청이 새 버전으로 옛 데이터를 담지 않는다.
 */
export async function bumpCacheVersion(key: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.incr(key);
  } catch (error) {
    // 실패하면 캐시 TTL이 지날 때까지 옛 값이 보일 수 있다.
    logCacheError(redis, '버전 증가', key, error);
  }
}

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const redis = getRedisClient();
  if (!redis) return load();

  try {
    const cached = await redis.get(key);
    if (cached !== null) return JSON.parse(cached, reviveDates) as T;
  } catch (error) {
    logCacheError(redis, '조회', key, error);
  }

  const value = await load();

  // 저장은 응답을 기다리게 하지 않는다.
  redis
    .set(key, JSON.stringify(value), 'EX', ttlSeconds)
    .catch((error: unknown) => logCacheError(redis, '저장', key, error));

  return value;
}
