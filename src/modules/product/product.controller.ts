import type { Request, Response } from 'express';

import {
  createProductSchema,
  productHistoryQuerySchema,
  productIdParamsSchema,
  searchProductsSchema,
  updateProductSchema,
} from './product.schema';
import * as productService from './product.service';

export async function getProducts(req: Request, res: Response): Promise<void> {
  const query = searchProductsSchema.parse(req.query);

  const result = await productService.searchProducts({
    ...query,
    organizationId: req.auth!.organizationId,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
}

// 상품 등록 내역 화면용. 목록 조건은 getProducts와 같고 등록자만 본인으로 고정한다.
export async function getMyProducts(
  req: Request,
  res: Response,
): Promise<void> {
  const query = searchProductsSchema.parse(req.query);

  const result = await productService.searchProducts({
    ...query,
    organizationId: req.auth!.organizationId,
    createdById: req.auth!.userId,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
}

export async function getProduct(req: Request, res: Response): Promise<void> {
  const { id } = productIdParamsSchema.parse(req.params);

  const result = await productService.getProduct(id, req.auth!);

  res.status(200).json({
    success: true,
    data: result,
  });
}

export async function createProduct(
  req: Request,
  res: Response,
): Promise<void> {
  const data = createProductSchema.parse(req.body);

  const result = await productService.createProduct({
    ...data,
    requester: req.auth!,
  });

  res.status(201).json({
    success: true,
    data: result,
  });
}

export async function updateProduct(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = productIdParamsSchema.parse(req.params);
  const data = updateProductSchema.parse(req.body);

  const result = await productService.updateProduct({
    productId: id,
    requester: req.auth!,
    data,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
}

export async function deleteProduct(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = productIdParamsSchema.parse(req.params);

  const result = await productService.deleteProduct({
    productId: id,
    requester: req.auth!,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
}

export async function getProductHistory(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = productIdParamsSchema.parse(req.params);
  const query = productHistoryQuerySchema.parse(req.query);

  const result = await productService.getProductHistory(id, req.auth!, query);

  res.status(200).json({
    success: true,
    data: result,
  });
}
