import { ForbiddenError, NotFoundError } from '../../types/errors';
import { invalidateProductListCache } from '../product/product.cache';
import * as wishlistRepository from './wishlist.repository';
import type { WishlistListRow } from './wishlist.repository';

type GetWishlistParams = {
  userId: number;
  organizationId: number;
  page: number;
  limit: number;
};

type WishlistProductItem = WishlistListRow['product'];

type GetWishlistResult = {
  items: WishlistProductItem[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
};

type GetWishlistIdsParams = {
  userId: number;
  organizationId: number;
};

type AddWishlistItemParams = {
  userId: number;
  organizationId: number;
  productId: number;
};

type RemoveWishlistItemParams = {
  userId: number;
  // 상품 목록 캐시(wishlistCount) 무효화에 쓴다.
  organizationId: number;
  productId: number;
};

type RemoveWishlistItemsParams = {
  userId: number;
  organizationId: number;
  productIds: number[];
};

export async function getWishlist({
  userId,
  organizationId,
  page,
  limit,
}: GetWishlistParams): Promise<GetWishlistResult> {
  const [rows, totalCount] = await wishlistRepository.findMany({
    userId,
    organizationId,
    skip: (page - 1) * limit,
    take: limit,
  });

  const totalPages = Math.ceil(totalCount / limit);

  return {
    items: rows.map((row) => row.product),
    page,
    limit,
    totalCount,
    totalPages,
    hasNext: page < totalPages,
  };
}

export async function getWishlistIds({
  userId,
  organizationId,
}: GetWishlistIdsParams): Promise<{ productIds: number[] }> {
  const rows = await wishlistRepository.findAllIds(userId, organizationId);
  return { productIds: rows.map((row) => row.productId) };
}

export async function addWishlistItem({
  userId,
  organizationId,
  productId,
}: AddWishlistItemParams): Promise<{ productId: number }> {
  const product = await wishlistRepository.findAccessById(productId);

  if (!product || product.isDeleted) {
    throw new NotFoundError('상품을 찾을 수 없습니다.');
  }

  if (product.organizationId !== organizationId) {
    throw new ForbiddenError('다른 조직의 상품은 찜할 수 없습니다.');
  }

  const result = await wishlistRepository.upsert(userId, productId);
  // 상품 목록의 찜 개수가 바뀐다.
  await invalidateProductListCache(organizationId);

  return result;
}

export async function removeWishlistItem({
  userId,
  organizationId,
  productId,
}: RemoveWishlistItemParams): Promise<{
  productId: number;
  deletedCount: number;
}> {
  const { count } = await wishlistRepository.deleteOne(userId, productId);
  if (count > 0) await invalidateProductListCache(organizationId);

  return { productId, deletedCount: count };
}

export async function removeWishlistItems({
  userId,
  organizationId,
  productIds,
}: RemoveWishlistItemsParams): Promise<{ deletedCount: number }> {
  const { count } = await wishlistRepository.deleteMany(userId, productIds);
  if (count > 0) await invalidateProductListCache(organizationId);
  return { deletedCount: count };
}
