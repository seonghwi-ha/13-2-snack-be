import { Router } from 'express';

import { authenticate } from '../middlewares/auth.middleware';
import { idempotent } from '../middlewares/idempotency.middleware';
import * as orderController from '../modules/order/order.controller';

const router = Router();

// Idempotency-Key 헤더를 보내면 재시도해도 구매 요청이 한 번만 만들어진다. (선택)
router.post('/', authenticate, idempotent, orderController.createOrder);

export default router;
