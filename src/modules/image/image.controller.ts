import { pipeline } from 'node:stream/promises';

import type { Request, Response } from 'express';

import { BadRequestError } from '../../types/errors';
import { getImageUrl } from '../../utils/imageUrl';
import { imageKeyParamsSchema } from './image.schema';
import * as imageService from './image.service';

/*
@ 이미지 API (Private S3 + BE 중계)
- 브라우저는 S3를 모르고, 모든 이미지 요청이 우리 API를 거친다.
- 업로드 응답의 imageKey는 백엔드용(교체·삭제 때 S3 파일 지목), imageUrl은 프론트가 그대로 쓴다.
*/

export async function createImage(req: Request, res: Response): Promise<void> {
  // multer-s3가 채워 넣는 key까지 아는 타입으로 좁힌다.
  const file = req.file as Express.MulterS3.File | undefined;

  // 파일 없이 요청하면 multer는 에러 없이 통과시키므로 여기서 막는다.
  if (!file) {
    throw new BadRequestError('image 필드에 이미지 파일을 담아 보내주세요.');
  }

  await imageService.recordUploadedImage(file.key, req.auth!);

  res.status(201).json({
    success: true,
    data: {
      imageKey: file.key,
      imageUrl: getImageUrl(file.key),
    },
  });
}

export async function getImage(req: Request, res: Response): Promise<void> {
  const { key } = imageKeyParamsSchema.parse(req.params);

  // 리다이렉트 방식이면 서버가 이미지를 받지 않고 주소만 알려준다. (image.service.ts 참고)
  if (imageService.isImageRedirectMode()) {
    const redirect = await imageService.getImageRedirect(key);

    res.setHeader('Cache-Control', redirect.cacheControl);
    res.redirect(302, redirect.url);
    return;
  }

  const image = await imageService.getImageObject(key);

  res.setHeader('Content-Type', image.contentType);
  if (image.contentLength !== undefined) {
    res.setHeader('Content-Length', image.contentLength);
  }
  // key가 UUID라 같은 주소의 내용이 바뀌지 않는다.
  // 조회에 인증이 없으므로 공용 캐시(CDN 등)에도 오래 담아둘 수 있다.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  // 올린 파일을 브라우저가 이미지가 아닌 다른 형식으로 해석하지 못하게 막는다.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  await pipeline(image.body, res);
}

export async function deleteImage(req: Request, res: Response): Promise<void> {
  const { key } = imageKeyParamsSchema.parse(req.params);

  await imageService.deleteImage(key, req.auth!);

  res.status(200).json({
    success: true,
    data: { imageKey: key },
  });
}
