import { ErrorRequestHandler } from 'express';
import { UnauthorizedError as ExpressJwtUnauthorizedError } from 'express-jwt';
import { ZodError } from 'zod';

import { Prisma } from '../generated/prisma/client';
import { clearCookieOptions } from '../modules/auth/auth.controller';
import { AppError } from '../types/errors';

/*
@ 전역 에러 핸들러
- 서비스 레이어에서 throw한 에러를 응답 형식 컨벤션으로 변환한다.
  성공 { success: true, data } / 실패 { success: false, message, code }
- app.ts에서 라우터·404 핸들러 다음, 항상 마지막에 등록한다.
@ 주의사항
- Prisma 에러 분기(P2002 / P2025)는 스키마 확정 이후 추가 완료됨.
  import 경로는 `../generated/prisma/client`
  (이 파일이 src/middlewares/에 있고, generator output이
  src/generated/prisma이므로 한 단계만 올라가면 됨)
- P2003(FK 제약 위반)은 400 INVALID_REFERENCE로 응답한다.
  그 밖에 아직 마주친 적 없는 코드는 필요 시 추가한다.
*/

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // 이미 응답이 전송되기 시작했다면 중복 응답을 막고 Express 기본 핸들러에 위임
  if (res.headersSent) {
    return next(err);
  }

  // 1) 우리가 만든 커스텀 에러
  // instanceof로 "우리 에러"만 정확히 걸러낸다.
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
    });
  }

  // express-jwt 검증 실패 에러 추가
  if (err instanceof ExpressJwtUnauthorizedError) {
    const isTokenExpired =
      err.inner instanceof Error && err.inner.name === 'TokenExpiredError';
    const isRefreshRequest = req.path === '/auth/refresh-token';

    // 쿠키가 없거나 access 만료(refresh로 복구 가능)가 아니면 다시 쓸 수 없는 토큰이므로 지운다.
    if (
      err.code !== 'credentials_required' &&
      !(isTokenExpired && !isRefreshRequest)
    ) {
      res
        .clearCookie('accessToken', clearCookieOptions)
        .clearCookie('refreshToken', clearCookieOptions);
    }

    if (err.code === 'revoked_token') {
      return res.status(401).json({
        success: false,
        message: '인증 정보가 변경되었습니다. 다시 로그인해주세요.',
        code: 'TOKEN_REVOKED',
      });
    }

    const message = !isTokenExpired
      ? '로그인이 필요합니다.'
      : isRefreshRequest
        ? '세션이 만료되었습니다. 다시 로그인해주세요.'
        : '인증 토큰이 만료되었습니다.';

    const code = !isTokenExpired
      ? 'UNAUTHORIZED'
      : isRefreshRequest
        ? 'SESSION_EXPIRED'
        : 'TOKEN_EXPIRED';

    return res.status(401).json({
      success: false,
      message,
      code,
    });
  }

  // 2) Zod 유효성 검사 실패
  // 서비스 로직의 BadRequest와 "스키마 검증 실패"를 응답만 보고 구분하기 위해
  // 상태코드는 400이지만 code는 VALIDATION_ERROR로 분리한다.
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: err.issues[0]?.message ?? '입력값이 유효하지 않습니다.',
      code: 'VALIDATION_ERROR',
    });
  }

  // 3) 잘못된 JSON 형태
  if (err instanceof SyntaxError) {
    res.status(400).json({
      success: false,
      message: '잘못된 JSON 형식입니다.',
      code: 'BAD_REQUEST',
    });
    return;
  }

  // 4) Prisma에서 던지는 알려진 에러
  // 대부분 서비스 레이어에서 사전 체크로 걸러지지만, 동시 요청 등으로
  // 사전 체크와 실제 쿼리 사이에 상태가 바뀌는 극히 드문 경우를 대비한 방어 코드.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: '이미 사용 중인 값입니다.',
        code: 'DUPLICATE_VALUE',
      });
    }

    // 외래키 위반. 없는 카테고리·상품 id처럼 존재하지 않는 대상을 가리킨 요청이라
    // 서버 오류(500)가 아니라 요청 오류(400)로 본다.
    if (err.code === 'P2003') {
      return res.status(400).json({
        success: false,
        message: '참조하는 대상이 존재하지 않습니다.',
        code: 'INVALID_REFERENCE',
      });
    }

    if (err.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: '대상을 찾을 수 없습니다.',
        code: 'NOT_FOUND',
      });
    }
  }

  // 5) 예상 못 한 모든 에러 (최후의 보루)
  // 상세 원인은 서버 로그에만, 사용자에겐 일반 메시지만 노출
  console.error('Unhandled error:', err);
  return res.status(500).json({
    success: false,
    message: '서버 에러가 발생했습니다.',
    code: 'INTERNAL_SERVER_ERROR',
  });
};

export default errorHandler;
