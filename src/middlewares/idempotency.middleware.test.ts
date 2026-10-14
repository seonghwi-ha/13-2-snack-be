import { EventEmitter } from 'node:events';

import type { NextFunction, Request, Response } from 'express';

import * as idempotencyRepository from '../modules/idempotency/idempotency.repository';
import { idempotent } from './idempotency.middleware';

jest.mock('../modules/idempotency/idempotency.repository');

const repository = jest.mocked(idempotencyRepository);
const KEY = 'order-7f3c2a1e-0b4d';

function createRequest(body: unknown = { items: [{ cartItemId: 1 }] }) {
  const headers: Record<string, string> = { 'idempotency-key': KEY };
  return {
    method: 'POST',
    baseUrl: '/orders',
    path: '/',
    body,
    auth: { userId: 10 },
    get: (name: string) => headers[name.toLowerCase()],
    headers,
  } as unknown as Request & { headers: Record<string, string> };
}

function createResponse() {
  const emitter = new EventEmitter();
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    sentBody: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
    json(body: unknown) {
      res.sentBody = body;
      return res;
    },
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
  return res;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function run(req: Request, res: ReturnType<typeof createResponse>) {
  const next: NextFunction = jest.fn();
  await idempotent(req, res as unknown as Response, next);
  return next as jest.Mock;
}

beforeEach(() => {
  jest.resetAllMocks();
  repository.saveResponse.mockResolvedValue();
  repository.release.mockResolvedValue();
});

describe('멱등성 키 미들웨어', () => {
  test('헤더가 없으면 아무것도 하지 않고 넘긴다', async () => {
    const req = createRequest();
    delete req.headers['idempotency-key'];

    const next = await run(req, createResponse());

    expect(next).toHaveBeenCalledWith();
    expect(repository.claim).not.toHaveBeenCalled();
  });

  test.each(['short', 'has space key', 'a'.repeat(129), '키는한글불가능'])(
    '형식이 맞지 않는 키(%p)는 400으로 거부한다',
    async (key) => {
      const req = createRequest();
      req.headers['idempotency-key'] = key;

      const next = await run(req, createResponse());

      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 400,
        code: 'INVALID_IDEMPOTENCY_KEY',
      });
    },
  );

  test('처음 온 키는 사용자별로 선점하고 다음으로 넘긴다', async () => {
    repository.claim.mockResolvedValue({ isNew: true, id: 1 });

    const next = await run(createRequest(), createResponse());

    expect(next).toHaveBeenCalledWith();
    expect(repository.claim).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 10, key: KEY }),
    );
  });

  test('성공 응답은 저장한 뒤에 보낸다', async () => {
    repository.claim.mockResolvedValue({ isNew: true, id: 1 });
    let resolveSave: () => void = () => {};
    repository.saveResponse.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const res = createResponse();
    await run(createRequest(), res);

    res.status(201).json({ success: true, data: { id: 5 } });
    await flush();
    expect(res.sentBody).toBeUndefined();

    resolveSave();
    await flush();
    expect(repository.saveResponse).toHaveBeenCalledWith(1, 201, {
      success: true,
      data: { id: 5 },
    });
    expect(res.sentBody).toEqual({ success: true, data: { id: 5 } });
  });

  test.each([400, 409, 500])(
    '실패 응답(%i)은 저장하지 않고 키를 풀어 다시 시도할 수 있게 한다',
    async (status) => {
      repository.claim.mockResolvedValue({ isNew: true, id: 1 });
      const res = createResponse();
      await run(createRequest(), res);

      res.status(status).json({ success: false });
      await flush();

      expect(repository.release).toHaveBeenCalledWith(1);
      expect(repository.saveResponse).not.toHaveBeenCalled();
      expect(res.sentBody).toEqual({ success: false });
    },
  );

  test('저장에 실패해도 응답은 보낸다', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    repository.claim.mockResolvedValue({ isNew: true, id: 1 });
    repository.saveResponse.mockRejectedValue(new Error('db down'));
    const res = createResponse();
    await run(createRequest(), res);

    res.status(201).json({ success: true });
    await flush();

    expect(res.sentBody).toEqual({ success: true });
  });

  test('응답 없이 연결이 끊기면 키를 푼다', async () => {
    repository.claim.mockResolvedValue({ isNew: true, id: 1 });
    const res = createResponse();
    await run(createRequest(), res);

    res.emit('close');

    expect(repository.release).toHaveBeenCalledWith(1);
  });

  describe('이미 쓴 키로 다시 온 요청', () => {
    async function claimExistingWithSameHash(
      responseStatus: number | null,
    ): Promise<void> {
      // 첫 요청의 해시를 얻으려고 한 번 선점시킨다.
      repository.claim.mockResolvedValueOnce({ isNew: true, id: 1 });
      await run(createRequest(), createResponse());
      const { requestHash } = repository.claim.mock.calls[0][0];

      repository.claim.mockResolvedValueOnce({
        isNew: false,
        record: {
          id: 1,
          requestHash,
          responseStatus,
          responseBody: responseStatus
            ? { success: true, data: { id: 5 } }
            : null,
        },
      });
    }

    test('처음 요청이 성공했으면 같은 응답을 다시 돌려준다', async () => {
      await claimExistingWithSameHash(201);
      const res = createResponse();

      const next = await run(createRequest(), res);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(201);
      expect(res.headers['Idempotent-Replayed']).toBe('true');
      expect(res.sentBody).toEqual({ success: true, data: { id: 5 } });
    });

    test('처음 요청이 아직 처리 중이면 409를 준다', async () => {
      await claimExistingWithSameHash(null);

      const next = await run(createRequest(), createResponse());

      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 409,
        code: 'IDEMPOTENCY_IN_PROGRESS',
      });
    });

    test('같은 키로 다른 내용을 보내면 422로 거부한다', async () => {
      await claimExistingWithSameHash(201);
      const res = createResponse();

      await run(createRequest({ items: [{ cartItemId: 2 }] }), res);

      expect(res.statusCode).toBe(422);
      expect(res.sentBody).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });
  });
});
