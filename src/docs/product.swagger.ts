// src/docs/product.swagger.ts

/**
 * @openapi
 * tags:
 *   - name: Product
 *     description: 상품 (같은 조직의 상품만 조회, 등록, 수정, 삭제할 수 있음)
 */

/**
 * @openapi
 * components:
 *   parameters:
 *     ProductKeyword:
 *       in: query
 *       name: keyword
 *       schema:
 *         type: string
 *       description: 상품명 검색어 (대소문자 구분 없이 부분 일치). 결과가 없으면 응답의 suggestions에 비슷한 상품명을 준다
 *     ProductCategoryId:
 *       in: query
 *       name: categoryId
 *       schema:
 *         type: integer
 *         minimum: 1
 *       description: 소분류 카테고리 id. 그 카테고리의 상품만 조회
 *     ProductParentCategoryId:
 *       in: query
 *       name: parentCategoryId
 *       schema:
 *         type: integer
 *         minimum: 1
 *       description: 대분류 카테고리 id. 그 아래 모든 소분류의 상품을 조회
 *     ProductSort:
 *       in: query
 *       name: sort
 *       schema:
 *         type: string
 *         enum: [latest, popular, priceAsc, priceDesc]
 *         default: latest
 *       description: 최신순, 구매 횟수순, 낮은 가격순, 높은 가격순
 *     ProductPage:
 *       in: query
 *       name: page
 *       schema:
 *         type: integer
 *         minimum: 1
 *         default: 1
 *       description: 마지막 페이지를 넘으면 400
 *     ProductCursor:
 *       in: query
 *       name: cursor
 *       schema:
 *         type: string
 *       description: |
 *         커서 방식 페이지네이션. 이전 응답의 nextCursor를 그대로 보낸다.
 *         있으면 page는 무시한다. 정렬을 바꾸면 이전 커서는 400(INVALID_CURSOR)
 *     ProductLimit:
 *       in: query
 *       name: limit
 *       schema:
 *         type: integer
 *         minimum: 1
 *         maximum: 100
 *         default: 10
 *   schemas:
 *     ProductCategory:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 12
 *         name:
 *           type: string
 *           example: 과자
 *         parentId:
 *           type: integer
 *           nullable: true
 *           example: 1
 *     ProductListItem:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: 새우깡
 *         price:
 *           type: integer
 *           example: 1500
 *           description: 원 단위
 *         imageUrl:
 *           type: string
 *           nullable: true
 *           example: /api/images/public/products/0b9e3c1a.jpg
 *         productUrl:
 *           type: string
 *           nullable: true
 *           example: https://www.coupang.com/vp/products/123
 *           description: 실제 구매할 외부 판매처 링크
 *         purchaseCount:
 *           type: integer
 *           example: 12
 *         createdAt:
 *           type: string
 *           format: date-time
 *         category:
 *           $ref: '#/components/schemas/ProductCategory'
 *         wishlistCount:
 *           type: integer
 *           example: 3
 *           description: 이 상품을 찜한 사람 수
 *     ProductDetail:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: 새우깡
 *         price:
 *           type: integer
 *           example: 1500
 *         imageUrl:
 *           type: string
 *           nullable: true
 *           example: /api/images/public/products/0b9e3c1a.jpg
 *         productUrl:
 *           type: string
 *           nullable: true
 *           example: https://www.coupang.com/vp/products/123
 *         purchaseCount:
 *           type: integer
 *           example: 12
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         category:
 *           $ref: '#/components/schemas/ProductCategory'
 *         createdBy:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *               example: 2
 *             name:
 *               type: string
 *               example: 이직원
 *         wishlistCount:
 *           type: integer
 *           example: 3
 *         isMine:
 *           type: boolean
 *           description: 요청자가 등록한 상품인지 (수정, 삭제 메뉴 노출 판단용)
 *     ProductListResult:
 *       type: object
 *       properties:
 *         products:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ProductListItem'
 *         page:
 *           type: integer
 *           example: 1
 *           description: page로 요청했을 때만 있음
 *         limit:
 *           type: integer
 *           example: 10
 *         totalCount:
 *           type: integer
 *           example: 25
 *         totalPages:
 *           type: integer
 *           example: 3
 *           description: page로 요청했을 때만 있음
 *         hasNext:
 *           type: boolean
 *           example: true
 *         nextCursor:
 *           type: string
 *           nullable: true
 *           description: 다음 묶음 요청에 cursor로 보낼 값. 다음 페이지가 없으면 null
 *           example: eyJzb3J0IjoibGF0ZXN0IiwidmFsdWUiOiIyMDI2LTA5LTAxVDAwOjAwOjAwLjAwMFoiLCJpZCI6MTJ9
 *         suggestions:
 *           type: array
 *           items:
 *             type: string
 *           description: |
 *             keyword 검색 결과가 0건일 때 비슷한 상품명(최대 5개, 유사도 높은 순).
 *             오타 검색에 "혹시 이 상품을 찾으셨나요?"를 보여줄 때 쓴다. 그 밖에는 빈 배열
 *           example: [농심 새우깡, 새우깡]
 *     CreateProductRequest:
 *       type: object
 *       required: [name, price, categoryId]
 *       properties:
 *         name:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *           example: 새우깡
 *         price:
 *           type: integer
 *           minimum: 0
 *           maximum: 100000000
 *           example: 1500
 *           description: 원 단위 정수
 *         categoryId:
 *           type: integer
 *           minimum: 1
 *           example: 12
 *         imageUrl:
 *           type: string
 *           nullable: true
 *           example: /api/images/public/products/0b9e3c1a.jpg
 *           description: 이미지 업로드 응답의 imageUrl 또는 외부 이미지 주소. 빈 문자열이나 null이면 이미지를 비움
 *         productUrl:
 *           type: string
 *           nullable: true
 *           example: https://www.coupang.com/vp/products/123
 *           description: 외부 판매처 링크. 빈 문자열이나 null이면 링크를 비움
 *     UpdateProductRequest:
 *       type: object
 *       minProperties: 1
 *       description: 등록 항목 중 수정할 값만 보냅니다. 하나 이상 필요합니다.
 *       properties:
 *         name:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *         price:
 *           type: integer
 *           minimum: 0
 *           maximum: 100000000
 *         categoryId:
 *           type: integer
 *           minimum: 1
 *         imageUrl:
 *           type: string
 *           nullable: true
 *         productUrl:
 *           type: string
 *           nullable: true
 */

/**
 * @openapi
 * /products:
 *   get:
 *     summary: 상품 목록 조회
 *     description: 로그인한 사용자 조직의 상품(삭제되지 않은 것)을 검색, 필터, 정렬, 페이지네이션해서 반환합니다.
 *     tags: [Product]
 *     parameters:
 *       - $ref: '#/components/parameters/ProductKeyword'
 *       - $ref: '#/components/parameters/ProductCategoryId'
 *       - $ref: '#/components/parameters/ProductParentCategoryId'
 *       - $ref: '#/components/parameters/ProductSort'
 *       - $ref: '#/components/parameters/ProductCursor'
 *       - $ref: '#/components/parameters/ProductPage'
 *       - $ref: '#/components/parameters/ProductLimit'
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
 *                       $ref: '#/components/schemas/ProductListResult'
 *       400:
 *         description: 유효성 검사 실패 (VALIDATION_ERROR), 마지막 페이지를 넘는 page (BAD_REQUEST)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   post:
 *     summary: 상품 등록
 *     description: 로그인한 모든 사용자가 등록할 수 있습니다. 등록자와 조직은 로그인 정보로 정해지고 바디로 받지 않습니다.
 *     tags: [Product]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateProductRequest'
 *     responses:
 *       201:
 *         description: 등록 성공
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/ProductDetail'
 *       400:
 *         description: 유효성 검사 실패 (VALIDATION_ERROR), 존재하지 않는 카테고리 (BAD_REQUEST)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @openapi
 * /me/products:
 *   get:
 *     summary: 내가 등록한 상품 목록 조회
 *     description: 상품 등록 내역 화면용입니다. 조건과 응답은 GET /products와 같고 등록자가 본인인 상품만 반환합니다.
 *     tags: [Product]
 *     parameters:
 *       - $ref: '#/components/parameters/ProductKeyword'
 *       - $ref: '#/components/parameters/ProductCategoryId'
 *       - $ref: '#/components/parameters/ProductParentCategoryId'
 *       - $ref: '#/components/parameters/ProductSort'
 *       - $ref: '#/components/parameters/ProductCursor'
 *       - $ref: '#/components/parameters/ProductPage'
 *       - $ref: '#/components/parameters/ProductLimit'
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
 *                       $ref: '#/components/schemas/ProductListResult'
 *       400:
 *         description: 유효성 검사 실패 (VALIDATION_ERROR), 마지막 페이지를 넘는 page (BAD_REQUEST)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @openapi
 * /products/{id}:
 *   get:
 *     summary: 상품 상세 조회
 *     description: 다른 조직의 상품이나 삭제된 상품은 404로 응답합니다.
 *     tags: [Product]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
 *                       $ref: '#/components/schemas/ProductDetail'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   patch:
 *     summary: 상품 수정
 *     description: 등록자 본인 또는 ADMIN, SUPER_ADMIN만 수정할 수 있습니다. 등록자와 조직은 수정할 수 없습니다.
 *     tags: [Product]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProductRequest'
 *     responses:
 *       200:
 *         description: 수정 성공
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/ProductDetail'
 *       400:
 *         description: 유효성 검사 실패 또는 수정할 내용 없음 (VALIDATION_ERROR), 존재하지 않는 카테고리 (BAD_REQUEST)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: 본인이 등록한 상품이 아니고 관리자도 아님 (FORBIDDEN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: 상품 삭제
 *     description: 등록자 본인 또는 ADMIN, SUPER_ADMIN만 삭제할 수 있습니다. 소프트 삭제라 데이터는 남고 목록과 조회에서 제외됩니다.
 *     tags: [Product]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 삭제 성공
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
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: 본인이 등록한 상품이 아니고 관리자도 아님 (FORBIDDEN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
