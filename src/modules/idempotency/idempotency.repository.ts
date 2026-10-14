import { prisma } from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';

type ClaimData = {
  userId: number;
  key: string;
  requestHash: string;
  expiresAt: Date;
};

export type IdempotencyRecord = {
  id: number;
  requestHash: string;
  responseStatus: number | null;
  responseBody: Prisma.JsonValue | null;
};

export type ClaimResult =
  { isNew: true; id: number } | { isNew: false; record: IdempotencyRecord };

const recordSelect = {
  id: true,
  requestHash: true,
  responseStatus: true,
  responseBody: true,
} satisfies Prisma.IdempotencyKeySelect;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * 키를 "처리 중"으로 선점한다. 이미 있으면 그 기록을 돌려준다.
 * (userId, key) 유니크 제약으로 동시에 같은 키가 와도 한 요청만 선점한다.
 * 만료된 기록은 지우고 새로 선점한다.
 */
export async function claim(data: ClaimData): Promise<ClaimResult> {
  await prisma.idempotencyKey.deleteMany({
    where: {
      userId: data.userId,
      key: data.key,
      expiresAt: { lt: new Date() },
    },
  });

  try {
    const created = await prisma.idempotencyKey.create({
      data,
      select: { id: true },
    });
    return { isNew: true, id: created.id };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const record = await prisma.idempotencyKey.findUnique({
    where: { userId_key: { userId: data.userId, key: data.key } },
    select: recordSelect,
  });

  // 그 사이 선점한 요청이 실패해 키를 풀었다면 다시 선점한다.
  return record ? { isNew: false, record } : claim(data);
}

export async function saveResponse(
  id: number,
  responseStatus: number,
  responseBody: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { id },
    data: { responseStatus, responseBody },
  });
}

// 처리에 실패하면 키를 풀어 같은 키로 다시 시도할 수 있게 한다.
export async function release(id: number): Promise<void> {
  await prisma.idempotencyKey.deleteMany({ where: { id } });
}

export async function deleteExpired(now: Date): Promise<number> {
  const { count } = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}
