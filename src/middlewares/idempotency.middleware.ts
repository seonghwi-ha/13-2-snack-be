import { createHash } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import type { Prisma } from '../generated/prisma/client';
import * as idempotencyRepository from '../modules/idempotency/idempotency.repository';
import { BadRequestError, ConflictError } from '../types/errors';

/*
@ 멱등성 키 (Idempotency-Key 헤더)
- 더블클릭이나 응답을 못 받은 재시도로 같은 요청이 두 번 처리되는 것을 막는다.
  클라이언트가 요청마다 고유한 키를 만들고, 재시도할 때는 같은 키를 다시 보낸다.
- 헤더가 없으면 아무것도 하지 않는다. (기존 클라이언트 호환)
- 같은 키로 다시 오면
  · 처음 요청이 성공했으면 그 응답을 그대로 돌려준다. (Idempotent-Replayed: true)
  · 아직 처리 중이면 409 IDEMPOTENCY_IN_PROGRESS
  · 키는 같은데 내용이 다르면 422 IDEMPOTENCY_KEY_REUSED
- 성공(2xx)만 저장한다. 실패는 상태를 바꾸지 않았으므로 키를 풀어 같은 키로 다시 시도할 수 있게 한다.
- 응답은 기록을 저장한 뒤에 보낸다. 응답을 받은 뒤의 재시도는 항상 저장된 응답을 받는다.
- authenticate 뒤에 연결한다. 키는 사용자별로 구분한다.
*/

const IDEMPOTENCY_HEADER = 'Idempotency-Key';
// UUID(36자)가 들어가는 길이. 추측하기 쉬운 짧은 키는 받지 않는다.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

function hashRequest(req: Request): string {
  return createHash('sha256')
    .update(`${req.method} ${req.baseUrl}${req.path} `)
    .update(JSON.stringify(req.body ?? null))
    .digest('hex');
}

export async function idempotent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = req.get(IDEMPOTENCY_HEADER);

  if (key === undefined) {
    next();
    return;
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    next(
      new BadRequestError(
        'Idempotency-Key는 8~128자의 영문, 숫자, -, _만 쓸 수 있습니다.',
        'INVALID_IDEMPOTENCY_KEY',
      ),
    );
    return;
  }

  if (!req.auth) {
    next(new Error('idempotent는 authenticate 뒤에 연결되어야 합니다.'));
    return;
  }

  const requestHash = hashRequest(req);
  const claim = await idempotencyRepository.claim({
    userId: req.auth.userId,
    key,
    requestHash,
    expiresAt: new Date(Date.now() + IDEMPOTENCY_KEY_TTL_MS),
  });

  if (!claim.isNew) {
    const { record } = claim;

    if (record.requestHash !== requestHash) {
      res.status(422).json({
        success: false,
        message: '이미 다른 요청에 사용한 Idempotency-Key입니다.',
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
      return;
    }

    if (record.responseStatus === null) {
      next(
        new ConflictError(
          '같은 요청을 처리하고 있습니다. 잠시 후 다시 시도해주세요.',
          'IDEMPOTENCY_IN_PROGRESS',
        ),
      );
      return;
    }

    res.setHeader('Idempotent-Replayed', 'true');
    res.status(record.responseStatus).json(record.responseBody);
    return;
  }

  const { id } = claim;
  const sendJson = res.json.bind(res);
  let isSettled = false;

  // 컨트롤러와 errorHandler 모두 res.json으로 응답하므로 여기서 결과를 가로챈다.
  res.json = (body: unknown): Response => {
    isSettled = true;
    const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
    const record = isSuccess
      ? idempotencyRepository.saveResponse(
          id,
          res.statusCode,
          body as Prisma.InputJsonValue,
        )
      : idempotencyRepository.release(id);

    record
      .catch((error: unknown) => {
        // 기록에 실패해도 응답은 보낸다. 이 경우 재시도는 409(처리 중) 뒤 만료로 풀린다.
        console.error('멱등성 키 기록 실패:', key, error);
      })
      .finally(() => sendJson(body));

    return res;
  };

  // json 없이 연결이 끊긴 경우(클라이언트 중단 등) 키를 풀어 둔다.
  res.on('close', () => {
    if (!isSettled) {
      void idempotencyRepository.release(id).catch(() => {});
    }
  });

  next();
}
