import { OrderStatus, Role } from '../../generated/prisma/client';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../types/errors';
import { invalidateProductListCache } from '../product/product.cache';
import { DELIVERY_FEE } from './order.constants';
import * as orderRepository from './order.repository';

// ------------------------------
// POST /orders
// ------------------------------

type CreateOrderInput = {
  items: { cartItemId: number; quantity: number }[];
  requestMessage?: string;
};

export async function createOrder(
  userId: number,
  orgId: number,
  role: Role,
  data: CreateOrderInput,
) {
  const cartItemIds = data.items.map((item) => item.cartItemId);
  const cartItems = await orderRepository.findCartItemsByIds(
    cartItemIds,
    userId,
  );

  if (cartItems.length !== cartItemIds.length) {
    throw new BadRequestError(
      '유효하지 않은 장바구니 항목이 포함되어 있습니다.',
    );
  }

  const hasOtherOrgProduct = cartItems.some(
    (cartItem) => cartItem.product.organizationId !== orgId,
  );
  if (hasOtherOrgProduct) {
    throw new ForbiddenError('다른 조직의 상품이 포함되어 있습니다.');
  }

  const quantityMap = new Map(
    data.items.map((item) => [item.cartItemId, item.quantity]),
  );

  const orderItems = cartItems.map((cartItem) => {
    const quantity = quantityMap.get(cartItem.id)!;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestError('수량은 1 이상의 정수여야 합니다.');
    }
    return {
      productId: cartItem.productId,
      quantity,
      priceAtOrder: cartItem.product.price,
    };
  });

  const itemsTotal = orderItems.reduce(
    (sum, item) => sum + item.priceAtOrder * item.quantity,
    0,
  );
  const totalPrice = itemsTotal + DELIVERY_FEE;

  const isInstantBuy = role === Role.ADMIN || role === Role.SUPER_ADMIN;

  let order;

  if (isInstantBuy) {
    // 예산 검사는 빠른 실패와 안내 메시지용이다.
    // 동시 요청에 대한 최종 판단은 repository의 조건부 차감이 트랜잭션 안에서 한다.
    const budget = await orderRepository.findCurrentBudget(orgId);
    if (!budget) {
      throw new NotFoundError(
        '이번 달 예산 정보가 없습니다.',
        'BUDGET_NOT_FOUND',
      );
    }
    const remaining = budget.startingBudget - budget.spentAmount;
    if (remaining < totalPrice) {
      throw new ConflictError(
        '이번 달 남은 예산을 초과했습니다.',
        'BUDGET_EXCEEDED',
      );
    }

    order = await orderRepository.createApprovedOrder({
      organizationId: orgId,
      requesterId: userId,
      handlerId: userId,
      responseMessage: '관리자 즉시구매',
      deliveryFee: DELIVERY_FEE,
      totalPrice,
      items: orderItems,
      cartItemIds,
    });
    // 즉시 구매로 상품 구매 수(인기순)가 바뀐다.
    await invalidateProductListCache(orgId);
  } else {
    order = await orderRepository.createOrder({
      organizationId: orgId,
      requesterId: userId,
      requestMessage: data.requestMessage,
      deliveryFee: DELIVERY_FEE,
      totalPrice,
      items: orderItems,
      cartItemIds,
    });
  }

  return { id: order.id };
}

// ------------------------------
// GET /me/orders
// ------------------------------

type OrderListOptions = {
  sort: 'latest' | 'lowPrice' | 'highPrice';
  page: number;
  limit: number;
};

function toListItem(order: orderRepository.OrderListItem) {
  return {
    id: order.id,
    createdAt: order.createdAt,
    representativeProductName: order.items[0]?.product.name ?? '',
    totalItemCount: order.items.length,
    totalPrice: order.totalPrice,
    status: order.status,
    requester: order.requester,
    handler: order.handler,
  };
}

export async function getMyOrders(userId: number, options: OrderListOptions) {
  const [orders, totalCount] = await Promise.all([
    orderRepository.findMyOrders(userId, options),
    orderRepository.countMyOrders(userId),
  ]);

  return {
    items: orders.map(toListItem),
    totalCount,
    totalPages: Math.ceil(totalCount / options.limit),
    page: options.page,
  };
}

// ------------------------------
// GET /me/orders/:id
// ------------------------------

function toDetail(order: orderRepository.OrderDetail) {
  const itemsTotal = order.items.reduce(
    (sum, item) => sum + item.priceAtOrder * item.quantity,
    0,
  );

  return {
    id: order.id,
    status: order.status,
    itemsTotal,
    deliveryFee: order.deliveryFee,
    totalPrice: order.totalPrice,
    requestMessage: order.requestMessage,
    responseMessage: order.responseMessage,
    requester: order.requester,
    handler: order.handler,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.items.map((item) => ({
      productId: item.productId,
      productName: item.product.name,
      imageUrl: item.product.imageUrl,
      priceAtOrder: item.priceAtOrder,
      quantity: item.quantity,
      subtotal: item.priceAtOrder * item.quantity,
    })),
  };
}

export async function getMyOrderDetail(id: number, userId: number) {
  const order = await orderRepository.findMyOrderById(id, userId);
  if (!order) {
    throw new NotFoundError('요청한 구매 요청을 찾을 수 없습니다.');
  }
  return toDetail(order);
}

// ------------------------------
// DELETE /me/orders/:id
// ------------------------------

export async function cancelMyOrder(id: number, userId: number) {
  const order = await orderRepository.findOrderStatus(id, {
    requesterId: userId,
  });
  if (!order) {
    throw new NotFoundError('요청한 구매 요청을 찾을 수 없습니다.');
  }
  if (order.status !== OrderStatus.PENDING) {
    throw new ConflictError(
      '이미 처리된 구매 요청입니다.',
      'ORDER_ALREADY_PROCESSED',
    );
  }

  await orderRepository.cancelOrder(id, userId);
  return { id, status: OrderStatus.CANCELED };
}

// ------------------------------
// GET /admin/orders
// ------------------------------

type OrgOrderListOptions = OrderListOptions & { status?: OrderStatus };

export async function getOrgOrders(
  orgId: number,
  options: OrgOrderListOptions,
) {
  const [orders, totalCount] = await Promise.all([
    orderRepository.findOrgOrders(orgId, options),
    orderRepository.countOrgOrders(orgId, options.status),
  ]);

  return {
    items: orders.map(toListItem),
    totalCount,
    totalPages: Math.ceil(totalCount / options.limit),
    page: options.page,
  };
}

// ------------------------------
// GET /admin/orders/:id
// ------------------------------

export async function getOrgOrderDetail(id: number, orgId: number) {
  const order = await orderRepository.findOrgOrderById(id, orgId);
  if (!order) {
    throw new NotFoundError('요청한 구매 요청을 찾을 수 없습니다.');
  }
  return toDetail(order);
}

// ------------------------------
// PATCH /admin/orders/:id/approve
// ------------------------------

export async function approveOrder(
  id: number,
  orgId: number,
  handlerId: number,
  data: { responseMessage: string },
) {
  // 아래 상태·예산 검사는 빠른 실패와 안내 메시지용이다.
  // 동시 승인에 대한 최종 판단은 repository의 조건부 갱신이 트랜잭션 안에서 한다.
  const order = await orderRepository.findOrderStatus(id, {
    organizationId: orgId,
  });
  if (!order) {
    throw new NotFoundError('요청한 구매 요청을 찾을 수 없습니다.');
  }
  if (order.status !== OrderStatus.PENDING) {
    throw new ConflictError(
      '이미 처리된 구매 요청입니다.',
      'ORDER_ALREADY_PROCESSED',
    );
  }

  const budget = await orderRepository.findCurrentBudget(orgId);
  if (!budget) {
    throw new NotFoundError(
      '이번 달 예산 정보가 없습니다.',
      'BUDGET_NOT_FOUND',
    );
  }

  const remaining = budget.startingBudget - budget.spentAmount;
  if (remaining < order.totalPrice) {
    throw new ConflictError(
      '이번 달 남은 예산을 초과했습니다.',
      'BUDGET_EXCEEDED',
    );
  }

  const updated = await orderRepository.approveOrder(id, orgId, {
    handlerId,
    responseMessage: data.responseMessage,
  });
  // 승인으로 상품 구매 수(인기순)가 바뀐다.
  await invalidateProductListCache(orgId);

  return { id: updated.id, status: updated.status };
}

// ------------------------------
// PATCH /admin/orders/:id/reject
// ------------------------------

export async function rejectOrder(
  id: number,
  orgId: number,
  handlerId: number,
  data: { responseMessage: string },
) {
  const order = await orderRepository.findOrderStatus(id, {
    organizationId: orgId,
  });
  if (!order) {
    throw new NotFoundError('요청한 구매 요청을 찾을 수 없습니다.');
  }
  if (order.status !== OrderStatus.PENDING) {
    throw new ConflictError(
      '이미 처리된 구매 요청입니다.',
      'ORDER_ALREADY_PROCESSED',
    );
  }

  await orderRepository.rejectOrder(id, orgId, {
    handlerId,
    responseMessage: data.responseMessage,
  });

  return { id, status: OrderStatus.REJECTED };
}
