import { Router } from 'express';

import { authenticate } from '../middlewares/auth.middleware';
import { uploadImageToS3 } from '../middlewares/upload.middleware';
import * as imageController from '../modules/image/image.controller';

const router = Router();

// 상품 등록이 일반 회원에게도 열려 있어 업로드는 로그인만 확인한다.
router.post('/', authenticate, uploadImageToS3, imageController.createImage);
// 조회는 로그인을 요구하지 않는다.
// 액세스 토큰이 15분이라 목록을 오래 띄워두면 지연 로딩되는 이미지가 401로 깨지고,
// <img>·next/image 요청은 fetchClient를 거치지 않아 토큰을 자동으로 재발급받지 못한다.
// key가 UUID라 주소를 모르면 열 수 없고, 버킷은 계속 프라이빗이다.
router.get('/*key', imageController.getImage);
// 업로드한 본인 또는 같은 조직의 관리자 이상이 지운다. 권한 판단은 서비스에서 한다.
router.delete('/*key', authenticate, imageController.deleteImage);

export default router;
