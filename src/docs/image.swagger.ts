// src/docs/image.swagger.ts

/**
 * @openapi
 * tags:
 *   - name: Image
 *     description: 이미지 업로드와 조회 (S3는 비공개이고 모든 요청이 서버를 거침)
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     ImageUploadResult:
 *       type: object
 *       properties:
 *         imageKey:
 *           type: string
 *           example: public/products/0b9e3c1a-5d2f-4c1e-9a7b-3f2d1e0c8b6a.jpg
 *           description: 백엔드용 식별자. 이미지 삭제 시 사용
 *         imageUrl:
 *           type: string
 *           example: /api/images/public/products/0b9e3c1a-5d2f-4c1e-9a7b-3f2d1e0c8b6a.jpg
 *           description: 프론트가 그대로 쓰는 이미지 주소 (프론트 rewrites용 경로)
 */

/**
 * @openapi
 * /images:
 *   post:
 *     summary: 이미지 업로드
 *     description: |
 *       로그인한 모든 사용자가 업로드할 수 있습니다.
 *       multipart/form-data의 image 필드로 한 장만 보내며, jpg, png, webp, gif 형식에 5MB 이하만 가능합니다.
 *       파일명은 서버가 UUID로 새로 만듭니다.
 *     tags: [Image]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: 업로드 성공
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/ImageUploadResult'
 *       400:
 *         description: >
 *           파일 없음, 허용되지 않는 형식, 5MB 초과, 두 장 이상,
 *           필드명이 image가 아님 등 업로드 실패 (BAD_REQUEST)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @openapi
 * /images/{key}:
 *   get:
 *     summary: 이미지 조회
 *     description: |
 *       로그인 없이 호출할 수 있습니다. 응답은 JSON이 아니라 이미지 바이너리입니다.
 *       key는 슬래시를 포함한 전체 경로(public/products/...)이고, 상품 이미지 폴더 밖의 경로는 400입니다.
 *       응답은 Cache-Control: public, max-age=31536000, immutable로 캐시됩니다.
 *
 *       서버 설정 IMAGE_DELIVERY_MODE=redirect이면 이미지 대신 302로 리다이렉트합니다.
 *       IMAGE_CDN_BASE_URL이 있으면 CloudFront 주소로, 없으면 1시간 유효한 S3 presigned URL로 보냅니다.
 *       <img>와 next/image는 리다이렉트를 자동으로 따라가므로 프론트 수정은 필요 없습니다.
 *     tags: [Image]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: 업로드 응답의 imageKey (예 public/products/0b9e3c1a.jpg)
 *     responses:
 *       302:
 *         description: 리다이렉트 방식일 때 이미지 주소(Location 헤더)
 *       200:
 *         description: 이미지 바이너리
 *         content:
 *           image/*:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: 이미지 삭제
 *     description: |
 *       업로드한 본인 또는 같은 조직의 ADMIN, SUPER_ADMIN이 호출할 수 있습니다.
 *       업로드 기록이 없는 예전 이미지는 ADMIN, SUPER_ADMIN만 지울 수 있습니다.
 *       삭제하면 같은 조직에서 이 이미지를 쓰던 상품의 imageUrl도 null로 비웁니다.
 *       S3는 없는 key를 삭제해도 성공으로 응답하므로 이미 없는 이미지도 200입니다.
 *     tags: [Image]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: 업로드 응답의 imageKey
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
 *                         imageKey:
 *                           type: string
 *                           example: public/products/0b9e3c1a-5d2f-4c1e-9a7b-3f2d1e0c8b6a.jpg
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
