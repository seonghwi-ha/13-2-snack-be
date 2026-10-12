import Redis from 'ioredis';

/*
@ Redis 클라이언트 (캐시 전용)
- REDIS_URL이 없으면 null을 돌려주고 캐시를 쓰지 않는다. Redis 없는 팀원 로컬과 기존 서버도 그대로 동작한다.
- 캐시는 없어도 되는 부가 기능이라, Redis가 끊기거나 느려도 요청이 기다리지 않게 한다.
  enableOfflineQueue: false → 연결이 없을 때 명령을 쌓아두지 않고 바로 실패
  commandTimeout → 응답이 늦으면 실패로 보고 DB에서 읽는다
- S3 클라이언트처럼 첫 사용 때 만든다.
*/

const COMMAND_TIMEOUT_MS = 300;

let client: Redis | null | undefined;

export function getRedisClient(): Redis | null {
  if (client !== undefined) return client;

  const url = process.env.REDIS_URL?.trim();

  if (!url) {
    client = null;
    return client;
  }

  client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: COMMAND_TIMEOUT_MS,
    connectTimeout: 2000,
  });

  // 재연결을 반복하는 동안 같은 에러가 계속 찍히지 않게 끊길 때 한 번만 남긴다.
  let isErrorLogged = false;

  client.on('error', (error) => {
    if (isErrorLogged) return;
    isErrorLogged = true;
    console.error(
      'Redis 연결 오류 (캐시 없이 DB로 응답합니다):',
      error.message,
    );
  });

  client.on('ready', () => {
    isErrorLogged = false;
  });

  return client;
}
