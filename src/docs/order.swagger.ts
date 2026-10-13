// src/docs/order.swagger.ts

/**
 * @openapi
 * tags:
 *   - name: Order
 *     description: 구매 요청 (요청, 승인, 반려, 취소, 즉시구매)
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     OrderStatus:
 *       type: string
 *       enum: [PENDING, APPROVED, REJECTED, CANCELED]
 *       description: 승인 대기, 승인 완료, 반려, 요청 취소
 *     OrderUser:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 2
 *         name:
 *           type: string
 *           example: 이직원
 *     CreateOrderRequest:
 *       type: object
 *       required: [items]
 *       properties:
 *         items:
 *           type: array
 *           minItems: 1
 *           items:
 *             type: object
 *             required: [cartItemId, quantity]
 *             properties:
 *               cartItemId:
 *                 type: integer
 *                 minimum: 1
 *                 example: 1
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 2
 *                 description: 장바구니에서 수량을 조정한 값. 이 값으로 주문됨
 *         requestMessage:
 *           type: string
 *           example: 사무실 간식으로 부탁드립니다.
 *           description: 앞뒤 공백 제거 후 빈 문자열이면 없는 것으로 처리. GENERAL 요청에만 저장됨
 *     OrderResponseMessageRequest:
 *       type: object
 *       required: [responseMessage]
 *       properties:
 *         responseMessage:
 *           type: string
 *           minLength: 1
 *           example: 승인합니다.
 *           description: 앞뒤 공백 제거 후 1자 이상 (승인과 반려 모두 필수)
 *     OrderListItem:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: 요청 일시
 *         representativeProductName:
 *           type: string
 *           example: 새우깡
 *           description: 첫 번째 항목의 상품명 (화면의 "○○ 외 N건" 표시에 사용)
 *         totalItemCount:
 *           type: integer
 *           example: 2
 *           description: 주문에 포함된 항목 수
 *         totalPrice:
 *           type: integer
 *           example: 6000
 *           description: 상품 합계에 배송비를 더한 금액
 *         status:
 *           $ref: '#/components/schemas/OrderStatus'
 *         requester:
 *           $ref: '#/components/schemas/OrderUser'
 *         handler:
 *           nullable: true
 *           description: 처리자. 승인 대기 또는 취소 상태면 null
 *           allOf:
 *             - $ref: '#/components/schemas/OrderUser'
 *     OrderListResult:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/OrderListItem'
 *         totalCount:
 *           type: integer
 *           example: 12
 *         totalPages:
 *           type: integer
 *           example: 2
 *         page:
 *           type: integer
 *           example: 1
 *     OrderDetailItem:
 *       type: object
 *       properties:
 *         productId:
 *           type: integer
 *           example: 5
 *         productName:
 *           type: string
 *           example: 새우깡
 *         imageUrl:
 *           type: string
 *           nullable: true
 *           example: /api/images/public/products/0b9e3c1a.jpg
 *           description: 상품의 현재 이미지 (주문 시점 스냅샷이 아님)
 *         priceAtOrder:
 *           type: integer
 *           example: 1500
 *           description: 주문 시점의 상품 가격 (이후 가격이 바뀌어도 유지)
 *         quantity:
 *           type: integer
 *           example: 2
 *         subtotal:
 *           type: integer
 *           example: 3000
 *           description: priceAtOrder 곱하기 quantity
 *     OrderDetail:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         status:
 *           $ref: '#/components/schemas/OrderStatus'
 *         itemsTotal:
 *           type: integer
 *           example: 3000
 *           description: 상품 합계 (배송비 제외)
 *         deliveryFee:
 *           type: integer
 *           example: 3000
 *         totalPrice:
 *           type: integer
 *           example: 6000
 *         requestMessage:
 *           type: string
 *           nullable: true
 *         responseMessage:
 *           type: string
 *           nullable: true
 *           description: 승인 또는 반려 메시지. 승인 대기나 취소 상태면 null이고 관리자 즉시구매는 "관리자 즉시구매"로 저장됨
 *         requester:
 *           $ref: '#/components/schemas/OrderUser'
 *         handler:
 *           nullable: true
 *           description: 처리자. 승인 대기나 취소 상태면 null이고 관리자 즉시구매는 요청자 본인
 *           allOf:
 *             - $ref: '#/components/schemas/OrderUser'
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: 요청 일시
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: 처리(승인, 반려, 취소) 일시. 주문은 한 번만 상태가 바뀌므로 처리 시점과 같음
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/OrderDetailItem'
 *     OrderStatusResult:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         status:
 *           $ref: '#/components/schemas/OrderStatus'
 *   parameters:
 *     OrderSort:
 *       in: query
 *       name: sort
 *       schema:
 *         type: string
 *         enum: [latest, lowPrice, highPrice]
 *         default: latest
 *       description: 최신순, 낮은 금액순, 높은 금액순
 *     OrderPage:
 *       in: query
 *       name: page
 *       schema:
 *         type: integer
 *         minimum: 1
 *         default: 1
 *     OrderLimit:
 *       in: query
 *       name: limit
 *       schema:
 *         type: integer
 *         minimum: 1
 *         default: 6
 *     OrderId:
 *       in: path
 *       name: id
 *       required: true
 *       schema:
 *         type: integer
 *       description: 구매 요청 id
 */

/**
 * @openapi
 * /orders:
 *   post:
 *     summary: 구매 요청 또는 즉시구매
 *     description: |
 *       장바구니 항목으로 구매를 요청합니다. 로그인한 모든 사용자가 호출할 수 있고, 역할에 따라 동작이 갈립니다.
 *       - GENERAL은 승인 대기(PENDING) 상태의 구매 요청이 만들어지고 관리자 승인을 거쳐야 합니다.
 *       - ADMIN, SUPER_ADMIN은 승인 단계 없이 즉시구매(APPROVED)로 처리되고 이번 달 예산이 차감됩니다.
 *
 *       수량은 바디 값을 쓰고 가격은 서버가 상품 가격으로 다시 계산하며 배송비 3,000원이 더해집니다.
 *       요청에 쓰인 장바구니 항목은 삭제됩니다. 완료 화면은 응답이 아니라 상세 조회로 그립니다.
 *
 *       같은 장바구니 항목으로 동시에 요청하면 한 건만 만들어지고 나머지는 400입니다.
 *       `Idempotency-Key` 헤더를 보내면, 응답을 받지 못해 같은 키로 다시 보낸 요청에
 *       처음 성공 응답을 그대로 돌려줍니다(`Idempotent-Replayed: true`). 실패 응답은 저장하지 않으며 키는 24시간 유지됩니다.
 *     tags: [Order]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema:
 *           type: string
 *           pattern: '^[A-Za-z0-9_-]{8,128}$'
 *         description: 요청마다 새로 만든 고유 값(예 UUID). 재시도할 때는 같은 값을 보낸다.
 *         example: 7f3c2a1e-0b4d-4c8e-9a51-2d6f0e1b3c4a
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOrderRequest'
 *     responses:
 *       201:
 *         description: 요청 또는 즉시구매 성공
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                           example: 1
 *                           description: 생성된 구매 요청 id
 *       400:
 *         description: 유효성 검사 실패 (VALIDATION_ERROR), 유효하지 않은 장바구니 항목 포함 (BAD_REQUEST), 형식이 잘못된 Idempotency-Key (INVALID_IDEMPOTENCY_KEY)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: 다른 조직의 상품이 포함됨 (FORBIDDEN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: 즉시구매에서 이번 달 예산 정보가 없음 (BUDGET_NOT_FOUND)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: 즉시구매에서 이번 달 남은 예산 부족 (BUDGET_EXCEEDED), 같은 Idempotency-Key 요청이 처리 중 (IDEMPOTENCY_IN_PROGRESS)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: 다른 내용의 요청에 이미 쓴 Idempotency-Key (IDEMPOTENCY_KEY_REUSED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /me/orders:
 *   get:
 *     summary: 내 구매 요청 목록 조회
 *     description: 내가 요청한 구매 요청을 상태와 관계없이 반환합니다.
 *     tags: [Order]
 *     parameters:
 *       - $ref: '#/components/parameters/OrderSort'
 *       - $ref: '#/components/parameters/OrderPage'
 *       - $ref: '#/components/parameters/OrderLimit'
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/OrderListResult'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @openapi
 * /me/orders/{id}:
 *   get:
 *     summary: 내 구매 요청 상세 조회
 *     description: 본인이 요청한 구매 요청만 조회할 수 있습니다. 다른 사람의 요청은 404입니다.
 *     tags: [Order]
 *     parameters:
 *       - $ref: '#/components/parameters/OrderId'
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/OrderDetail'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: 내 구매 요청 취소
 *     description: 승인 대기(PENDING) 상태의 본인 요청만 취소할 수 있습니다. 삭제가 아니라 상태가 CANCELED로 바뀌고 기록은 남습니다.
 *     tags: [Order]
 *     parameters:
 *       - $ref: '#/components/parameters/OrderId'
 *     responses:
 *       200:
 *         description: 취소 성공
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/OrderStatusResult'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: 이미 처리된 요청 (ORDER_ALREADY_PROCESSED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /admin/orders:
 *   get:
 *     summary: 조직 전체 구매 요청 목록 조회
 *     description: |
 *       ADMIN, SUPER_ADMIN만 호출할 수 있습니다.
 *       승인 대기 화면과 승인 완료 화면이 같은 응답 형태라 status 쿼리로 구분하는 하나의 엔드포인트로 통합했습니다.
 *       status는 필수이고 PENDING 또는 APPROVED만 가능합니다. 승인 대기 목록에서 handler는 null입니다.
 *     tags: [Order]
 *     parameters:
 *       - in: query
 *         name: status
 *         required: true
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED]
 *         description: 승인 대기 또는 승인 완료
 *       - $ref: '#/components/parameters/OrderSort'
 *       - $ref: '#/components/parameters/OrderPage'
 *       - $ref: '#/components/parameters/OrderLimit'
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/OrderListResult'
 *       400:
 *         description: status 누락 또는 허용되지 않는 값 등 유효성 검사 실패 (VALIDATION_ERROR)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @openapi
 * /admin/orders/{id}:
 *   get:
 *     summary: 구매 요청 상세 조회
 *     description: ADMIN, SUPER_ADMIN만 호출할 수 있습니다. 같은 조직의 구매 요청만 조회할 수 있고 다른 조직의 요청은 404입니다.
 *     tags: [Order]
 *     parameters:
 *       - $ref: '#/components/parameters/OrderId'
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/OrderDetail'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @openapi
 * /admin/orders/{id}/approve:
 *   patch:
 *     summary: 구매 요청 승인
 *     description: |
 *       ADMIN, SUPER_ADMIN만 호출할 수 있습니다.
 *       승인 대기(PENDING) 요청만 승인할 수 있고, 이번 달 예산이 부족하면 승인되지 않습니다.
 *       승인되면 상품의 구매 횟수가 늘고 이번 달 지출액이 요청 금액만큼 늘어납니다.
 *       responseMessage는 필수입니다.
 *     tags: [Order]
 *     parameters:
 *       - $ref: '#/components/parameters/OrderId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderResponseMessageRequest'
 *     responses:
 *       200:
 *         description: 승인 성공
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/OrderStatusResult'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: 구매 요청을 찾을 수 없음 (NOT_FOUND), 이번 달 예산 정보가 없음 (BUDGET_NOT_FOUND)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: 이미 처리된 요청 (ORDER_ALREADY_PROCESSED), 이번 달 남은 예산 부족 (BUDGET_EXCEEDED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /admin/orders/{id}/reject:
 *   patch:
 *     summary: 구매 요청 반려
 *     description: |
 *       ADMIN, SUPER_ADMIN만 호출할 수 있습니다.
 *       승인 대기(PENDING) 요청만 반려할 수 있고, 실제 구매가 없으므로 구매 횟수와 예산은 바뀌지 않습니다.
 *       responseMessage는 필수입니다.
 *     tags: [Order]
 *     parameters:
 *       - $ref: '#/components/parameters/OrderId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderResponseMessageRequest'
 *     responses:
 *       200:
 *         description: 반려 성공
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/OrderStatusResult'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: 이미 처리된 요청 (ORDER_ALREADY_PROCESSED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
