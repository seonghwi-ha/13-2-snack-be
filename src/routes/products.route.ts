import { Router } from 'express';

import { authenticate } from '../middlewares/auth.middleware';
import * as productController from '../modules/product/product.controller';

const router = Router();

// 등록은 일반 회원도 가능하고, 수정·삭제 권한은 등록자 조회가 필요해 service에서 검사한다.
router.get('/', authenticate, productController.getProducts);
router.get('/:id', authenticate, productController.getProduct);
// 변경 이력은 관리자 이상만 볼 수 있고, 조직 확인과 함께 service에서 검사한다.
router.get('/:id/history', authenticate, productController.getProductHistory);
router.post('/', authenticate, productController.createProduct);
router.patch('/:id', authenticate, productController.updateProduct);
router.delete('/:id', authenticate, productController.deleteProduct);

export default router;
