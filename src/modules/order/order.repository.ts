import { prisma } from '../../config/prisma';
import { OrderStatus, Prisma } from '../../generated/prisma/client';
import { BadRequestError, ConflictError } from '../../types/errors';
import { getKstDate } from '../../utils/date';

/*
@ 동시 요청 안전장치
- 상태 확인과 변경 사이에 다른 요청이 끼어들 수 있으므로, 최종 판단은 트랜잭션 안의 조건부 갱신으로 한다.
  · 주문 상태는 "PENDING일 때만" 바꾼다 → 중복 승인, 승인·취소 경합 방지
  · 예산은 "차감 후에도 시작 예산 이하일 때만" 차감한다 → 동시 승인으로 예산 초과 방지
  · 장바구니는 주문과 같은 트랜잭션에서 지우고, 다 지워졌을 때만 주문을 만든다 → 같은 장바구니로 중복 주문 방지
- PostgreSQL은 같은 행을 동시에 UPDATE하면 뒤 요청이 앞 요청의 커밋을 기다린 뒤 조건을 다시 평가한다.
  그래서 잠금을 따로 잡지 않아도 조건을 통과하는 요청은 한 건뿐이다.
- 조건이 맞지 않으면 에러를 던져 트랜잭션 전체를 되돌린다. (서비스의 사전 검사는 빠른 실패와 메시지용)
- 같은 조직의 승인·즉시 구매는 모두 예산 행을 거치므로, 예산을 먼저 차감해 순서를 맞추고
  상품 구매 수는 그 뒤에 올린다. 상품 행 잠금 순서가 엇갈려 생기는 교착을 피하려는 것이다.
*/

type TransactionClient = Prisma.TransactionClient;

function orderAlreadyProcessed(): ConflictError {
  return new ConflictError(
    '이미 처리된 구매 요청입니다.',
    'ORDER_ALREADY_PROCESSED',
  );
}

async function spendCurrentBudget(
  tx: TransactionClient,
  organizationId: number,
  amount: number,
): Promise<void> {
  const { year, month } = getCurrentBudgetPeriod();

  const updatedCount = await tx.$executeRaw`
    UPDATE "Budget"
    SET "spentAmount" = "spentAmount" + ${amount}, "updatedAt" = NOW()
    WHERE "organizationId" = ${organizationId}
      AND "year" = ${year}
      AND "month" = ${month}
      AND "spentAmount" + ${amount} <= "startingBudget"
  `;

  if (updatedCount === 0) {
    throw new ConflictError(
      '이번 달 남은 예산을 초과했습니다.',
      'BUDGET_EXCEEDED',
    );
  }
}

async function increasePurchaseCounts(
  tx: TransactionClient,
  items: { productId: number; quantity: number }[],
): Promise<void> {
  // 여러 요청이 같은 상품들을 올릴 때 항상 같은 순서로 잠그도록 정렬한다.
  const sortedItems = [...items].sort((a, b) => a.productId - b.productId);

  for (const item of sortedItems) {
    await tx.product.update({
      where: { id: item.productId },
      data: { purchaseCount: { increment: item.quantity } },
    });
  }
}

// 다른 요청이 먼저 지웠다면 일부만 지워진다. 그 경우 주문을 만들지 않고 되돌린다.
async function deleteOwnCartItems(
  tx: TransactionClient,
  cartItemIds: number[],
  userId: number,
): Promise<void> {
  const { count } = await tx.cartItem.deleteMany({
    where: { id: { in: cartItemIds }, userId },
  });

  if (count !== cartItemIds.length) {
    throw new BadRequestError(
      '유효하지 않은 장바구니 항목이 포함되어 있습니다.',
    );
  }
}

// ------------------------------
// select/include 상수 + 타입 추론
// ------------------------------

const orderDetailArgs = {
  include: {
    requester: { select: { id: true, name: true } }, // User
    handler: { select: { id: true, name: true } }, // User
    items: { include: { product: true } }, // OrderItem[] + Product
  },
} satisfies Prisma.OrderDefaultArgs;

export type OrderDetail = Prisma.OrderGetPayload<typeof orderDetailArgs>;

const orderListItemArgs = {
  include: {
    requester: { select: { id: true, name: true } }, // User
    handler: { select: { id: true, name: true } }, // User
    items: {
      select: {
        product: { select: { name: true } }, // OrderItem[] → Product.name만
      },
    },
  },
} satisfies Prisma.OrderDefaultArgs;

export type OrderListItem = Prisma.OrderGetPayload<typeof orderListItemArgs>;

// ------------------------------
// 이번 달 Budget 기준 연/월 (KST)
// ------------------------------

// budget 크론/조회와 같은 KST 기준의 "이번 달" 연/월
function getCurrentBudgetPeriod() {
  const today = getKstDate();
  return { year: today.year(), month: today.month() + 1 };
}

// ------------------------------
// POST /orders 관련
// ------------------------------

export function findCartItemsByIds(ids: number[], userId: number) {
  return prisma.cartItem.findMany({
    where: {
      id: { in: ids },
      userId,
    },
    include: {
      product: true,
    },
  });
}

type OrderItemInput = {
  productId: number;
  quantity: number;
  priceAtOrder: number;
};

export function createOrder(data: {
  organizationId: number;
  requesterId: number;
  requestMessage?: string;
  deliveryFee: number;
  totalPrice: number;
  items: OrderItemInput[];
  cartItemIds: number[];
}) {
  return prisma.$transaction(async (tx) => {
    await deleteOwnCartItems(tx, data.cartItemIds, data.requesterId);

    return tx.order.create({
      data: {
        status: OrderStatus.PENDING,
        organizationId: data.organizationId,
        requesterId: data.requesterId,
        requestMessage: data.requestMessage,
        deliveryFee: data.deliveryFee,
        totalPrice: data.totalPrice,
        items: {
          create: data.items,
        },
      },
    });
  });
}

export function createApprovedOrder(data: {
  organizationId: number;
  requesterId: number;
  handlerId: number;
  responseMessage: string;
  deliveryFee: number;
  totalPrice: number;
  items: OrderItemInput[];
  cartItemIds: number[];
}) {
  return prisma.$transaction(async (tx) => {
    await deleteOwnCartItems(tx, data.cartItemIds, data.requesterId);
    await spendCurrentBudget(tx, data.organizationId, data.totalPrice);

    const order = await tx.order.create({
      data: {
        status: OrderStatus.APPROVED,
        organizationId: data.organizationId,
        requesterId: data.requesterId,
        handlerId: data.handlerId,
        responseMessage: data.responseMessage,
        deliveryFee: data.deliveryFee,
        totalPrice: data.totalPrice,
        items: {
          create: data.items,
        },
      },
      include: { items: true },
    });

    await increasePurchaseCounts(tx, order.items);

    return order;
  });
}

// ------------------------------
// 상태 확인용 (cancel/approve/reject에서 재사용)
// ------------------------------

export function findOrderStatus(
  id: number,
  where: { requesterId?: number; organizationId?: number },
) {
  return prisma.order.findFirst({
    where: { id, ...where },
    select: { status: true, totalPrice: true },
  });
}

// ------------------------------
// GET /me/orders 관련
// ------------------------------

function resolveOrderBy(
  sort: 'latest' | 'lowPrice' | 'highPrice',
): Prisma.OrderOrderByWithRelationInput {
  if (sort === 'lowPrice') return { totalPrice: 'asc' };
  if (sort === 'highPrice') return { totalPrice: 'desc' };
  return { createdAt: 'desc' };
}

export function findMyOrders(
  userId: number,
  options: {
    sort: 'latest' | 'lowPrice' | 'highPrice';
    page: number;
    limit: number;
  },
) {
  return prisma.order.findMany({
    where: { requesterId: userId },
    orderBy: resolveOrderBy(options.sort),
    skip: (options.page - 1) * options.limit,
    take: options.limit,
    ...orderListItemArgs,
  });
}

export function countMyOrders(userId: number) {
  return prisma.order.count({ where: { requesterId: userId } });
}

export function findMyOrderById(id: number, userId: number) {
  return prisma.order.findFirst({
    where: { id, requesterId: userId },
    ...orderDetailArgs,
  });
}

export async function cancelOrder(id: number, userId: number): Promise<void> {
  const { count } = await prisma.order.updateMany({
    where: { id, requesterId: userId, status: OrderStatus.PENDING },
    data: { status: OrderStatus.CANCELED },
  });

  if (count === 0) {
    throw orderAlreadyProcessed();
  }
}

// ------------------------------
// GET /admin/orders 관련
// ------------------------------

export function findOrgOrders(
  orgId: number,
  options: {
    status?: OrderStatus;
    sort: 'latest' | 'lowPrice' | 'highPrice';
    page: number;
    limit: number;
  },
) {
  return prisma.order.findMany({
    where: {
      organizationId: orgId,
      ...(options.status && { status: options.status }),
    },
    orderBy: resolveOrderBy(options.sort),
    skip: (options.page - 1) * options.limit,
    take: options.limit,
    ...orderListItemArgs,
  });
}

export function countOrgOrders(orgId: number, status?: OrderStatus) {
  return prisma.order.count({
    where: {
      organizationId: orgId,
      ...(status && { status }),
    },
  });
}

export function findOrgOrderById(id: number, orgId: number) {
  return prisma.order.findFirst({
    where: { id, organizationId: orgId },
    ...orderDetailArgs,
  });
}

// ------------------------------
// approve / reject 관련
// ------------------------------

export function findCurrentBudget(orgId: number) {
  const { year, month } = getCurrentBudgetPeriod();
  return prisma.budget.findUnique({
    where: {
      organizationId_year_month: {
        organizationId: orgId,
        year,
        month,
      },
    },
  });
}

export function approveOrder(
  id: number,
  orgId: number,
  data: { handlerId: number; responseMessage: string },
) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id, organizationId: orgId, status: OrderStatus.PENDING },
      data: {
        status: OrderStatus.APPROVED,
        handlerId: data.handlerId,
        responseMessage: data.responseMessage,
      },
    });

    if (count === 0) {
      throw orderAlreadyProcessed();
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });

    await spendCurrentBudget(tx, orgId, order.totalPrice);
    await increasePurchaseCounts(tx, order.items);

    return order;
  });
}

export async function rejectOrder(
  id: number,
  orgId: number,
  data: { handlerId: number; responseMessage: string },
): Promise<void> {
  const { count } = await prisma.order.updateMany({
    where: { id, organizationId: orgId, status: OrderStatus.PENDING },
    data: {
      status: OrderStatus.REJECTED,
      handlerId: data.handlerId,
      responseMessage: data.responseMessage,
    },
  });

  if (count === 0) {
    throw orderAlreadyProcessed();
  }
}
