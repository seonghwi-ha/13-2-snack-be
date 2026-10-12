import type { Request, Response } from 'express';

import {
  batchDeleteWishlistBodySchema,
  wishlistListQuerySchema,
  wishlistProductIdParamsSchema,
} from './wishlist.schema';
import * as wishlistService from './wishlist.service';

export async function getWishlist(req: Request, res: Response): Promise<void> {
  const query = wishlistListQuerySchema.parse(req.query);
  const result = await wishlistService.getWishlist({
    ...query,
    userId: req.auth!.userId,
    organizationId: req.auth!.organizationId,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
}

export async function getWishlistIds(
  req: Request,
  res: Response,
): Promise<void> {
  const result = await wishlistService.getWishlistIds({
    userId: req.auth!.userId,
    organizationId: req.auth!.organizationId,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
}

export async function addWishlistItem(
  req: Request,
  res: Response,
): Promise<void> {
  const { productId } = wishlistProductIdParamsSchema.parse(req.params);

  const result = await wishlistService.addWishlistItem({
    userId: req.auth!.userId,
    organizationId: req.auth!.organizationId,
    productId,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
}

export async function removeWishlistItem(
  req: Request,
  res: Response,
): Promise<void> {
  const { productId } = wishlistProductIdParamsSchema.parse(req.params);

  const result = await wishlistService.removeWishlistItem({
    userId: req.auth!.userId,
    organizationId: req.auth!.organizationId,
    productId,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
}

export async function removeWishlistItems(
  req: Request,
  res: Response,
): Promise<void> {
  const { productIds } = batchDeleteWishlistBodySchema.parse(req.body);

  const result = await wishlistService.removeWishlistItems({
    userId: req.auth!.userId,
    organizationId: req.auth!.organizationId,
    productIds,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
}
