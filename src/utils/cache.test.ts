import { getRedisClient } from '../config/redis';
import { bumpCacheVersion, getOrSetCache, readCacheVersion } from './cache';

jest.mock('../config/redis', () => ({ getRedisClient: jest.fn() }));

const redis = {
  status: 'ready',
  get: jest.fn(),
  set: jest.fn(),
  incr: jest.fn(),
};
const mockedGetRedisClient = jest.mocked(getRedisClient);

beforeEach(() => {
  jest.resetAllMocks();
  mockedGetRedisClient.mockReturnValue(redis as never);
  redis.set.mockResolvedValue('OK');
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('캐시 조회·저장 (getOrSetCache)', () => {
  test('Redis 설정이 없으면 매번 원본에서 읽는다', async () => {
    mockedGetRedisClient.mockReturnValue(null);
    const load = jest.fn().mockResolvedValue({ value: 1 });

    const result = await getOrSetCache('key', 60, load);

    expect(result).toEqual({ value: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('캐시에 있으면 원본을 읽지 않고, ...At 날짜를 Date로 되살린다', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        createdAt: '2026-09-01T00:00:00.000Z',
        name: '2026-09-01T00:00:00.000Z',
      }),
    );
    const load = jest.fn();

    const result = await getOrSetCache<{ createdAt: Date; name: string }>(
      'key',
      60,
      load,
    );

    expect(load).not.toHaveBeenCalled();
    expect(result.createdAt).toEqual(new Date('2026-09-01T00:00:00.000Z'));
    // 이름처럼 At으로 끝나지 않는 필드는 문자열 그대로 둔다.
    expect(result.name).toBe('2026-09-01T00:00:00.000Z');
  });

  test('캐시에 없으면 원본을 읽고 TTL과 함께 저장한다', async () => {
    redis.get.mockResolvedValue(null);
    const load = jest.fn().mockResolvedValue({ value: 1 });

    await getOrSetCache('key', 60, load);

    expect(redis.set).toHaveBeenCalledWith('key', '{"value":1}', 'EX', 60);
  });

  test('Redis 조회가 실패해도 에러 없이 원본에서 읽는다', async () => {
    redis.get.mockRejectedValue(new Error('timeout'));
    const load = jest.fn().mockResolvedValue({ value: 1 });

    const result = await getOrSetCache('key', 60, load);

    expect(result).toEqual({ value: 1 });
  });

  test('Redis 저장이 실패해도 응답은 그대로 나간다', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockRejectedValue(new Error('timeout'));

    const result = await getOrSetCache('key', 60, async () => 'value');

    expect(result).toBe('value');
  });

  test('원본 조회 에러는 그대로 던지고 저장하지 않는다', async () => {
    redis.get.mockResolvedValue(null);

    const promise = getOrSetCache('key', 60, async () => {
      throw new Error('db down');
    });

    await expect(promise).rejects.toThrow('db down');
    expect(redis.set).not.toHaveBeenCalled();
  });
});

test('연결이 끊긴 동안에는 요청마다 실패 로그를 남기지 않는다', async () => {
  redis.get.mockRejectedValue(new Error('offline'));

  await getOrSetCache('key', 60, async () => 'value');
  expect(console.error).toHaveBeenCalledTimes(1);

  jest.mocked(console.error).mockClear();
  const offline = { ...redis, status: 'reconnecting' };
  mockedGetRedisClient.mockReturnValue(offline as never);

  await getOrSetCache('key', 60, async () => 'value');
  expect(console.error).not.toHaveBeenCalled();
});

describe('캐시 버전', () => {
  test('버전 키가 없으면 0이다', async () => {
    redis.get.mockResolvedValue(null);

    await expect(readCacheVersion('ver')).resolves.toBe('0');
  });

  test('Redis를 쓸 수 없으면 null이라 캐시를 건너뛴다', async () => {
    redis.get.mockRejectedValue(new Error('timeout'));
    await expect(readCacheVersion('ver')).resolves.toBeNull();

    mockedGetRedisClient.mockReturnValue(null);
    await expect(readCacheVersion('ver')).resolves.toBeNull();
  });

  test('버전 증가가 실패해도 에러를 던지지 않는다', async () => {
    redis.incr.mockRejectedValue(new Error('timeout'));

    await expect(bumpCacheVersion('ver')).resolves.toBeUndefined();
  });
});
