import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { Prisma } from '../generated/prisma/client';
import { ConflictError } from '../types/errors';
import errorHandler from './errorHandler';

// auth.controller가 불러오는 서비스·DB 설정 없이 쿠키 옵션만 쓴다.
jest.mock('../modules/auth/auth.controller', () => ({
  clearCookieOptions: {},
}));

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('prisma error', {
    code,
    clientVersion: 'test',
  });
}

function handle(err: unknown) {
  const res = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  };
  const next: NextFunction = jest.fn();

  errorHandler(
    err,
    { path: '/products' } as Request,
    res as unknown as Response,
    next,
  );

  return {
    status: res.status.mock.calls[0]?.[0],
    body: res.json.mock.calls[0]?.[0],
  };
}

describe('전역 에러 핸들러', () => {
  test('커스텀 에러는 상태코드와 code를 그대로 응답한다', () => {
    const result = handle(
      new ConflictError('예산을 초과했습니다.', 'BUDGET_EXCEEDED'),
    );

    expect(result).toEqual({
      status: 409,
      body: {
        success: false,
        message: '예산을 초과했습니다.',
        code: 'BUDGET_EXCEEDED',
      },
    });
  });

  test('Zod 검증 실패는 첫 메시지와 VALIDATION_ERROR로 응답한다', () => {
    const parsed = z
      .object({ name: z.string({ error: '이름' }) })
      .safeParse({});

    const result = handle(parsed.error);

    expect(result).toEqual({
      status: 400,
      body: { success: false, message: '이름', code: 'VALIDATION_ERROR' },
    });
  });

  test.each([
    ['P2002', 409, 'DUPLICATE_VALUE'],
    ['P2003', 400, 'INVALID_REFERENCE'],
    ['P2025', 404, 'NOT_FOUND'],
  ])('Prisma %s는 %i %s로 응답한다', (prismaCode, status, code) => {
    const result = handle(prismaError(prismaCode));

    expect(result.status).toBe(status);
    expect(result.body).toMatchObject({ success: false, code });
  });

  test('알 수 없는 에러는 원인을 숨기고 500으로 응답한다', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = handle(new Error('password=secret'));

    expect(result).toEqual({
      status: 500,
      body: {
        success: false,
        message: '서버 에러가 발생했습니다.',
        code: 'INTERNAL_SERVER_ERROR',
      },
    });
  });
});
