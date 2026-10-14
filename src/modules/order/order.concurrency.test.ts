/*
@ 구매 요청 동시성 테스트 (실제 PostgreSQL)
- 같은 요청이 동시에 들어올 때 예산·주문 상태가 어긋나지 않는지 확인한다.
  (중복 승인, 예산 초과, 승인·취소 경합, 같은 장바구니로 중복 주문)
- mock으로는 DB 잠금과 조건부 갱신을 확인할 수 없어서 실제 DB를 쓴다.
- TEST_DATABASE_URL이 있을 때만 실행한다. 이 DB에 마이그레이션이 적용돼 있어야 하고,
  테스트는 자기 데이터만 만들고 끝나면 지운다.
  예) TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/snack_test npm test
*/
import type { PrismaClient } from '../../generated/prisma/client';
import { getKstDate } from '../../utils/date';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;

type OrderService = typeof import('./order.service');
type IdempotencyRepository =
  typeof import('../idempotency/idempotency.repository');

describeWithDb('구매 요청 동시성 (실제 DB)', () => {
  let prisma: PrismaClient;
  let orderService: OrderService;
  let idempotencyRepository: IdempotencyRepository;

  // 테스트마다 새로 만드는 데이터
  let organizationId: number;
  let adminIds: [number, number];
  let userId: number;
  let productId: number;
  let budgetId: number;

  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { year, month } = (() => {
    const today = getKstDate();
    return { year: today.year(), month: today.month() + 1 };
  })();

  beforeAll(async () => {
    // config/prisma는 불러오는 시점의 DATABASE_URL로 연결한다.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    ({ prisma } = await import('../../config/prisma'));
    orderService = await import('./order.service');
    idempotencyRepository =
      await import('../idempotency/idempotency.repository');
  });

  beforeEach(async () => {
    const organization = await prisma.organization.create({
      data: {
        name: '동시성 테스트',
        bizRegNumber: `T${runId}${Math.random()}`,
      },
    });
    organizationId = organization.id;

    const createUser = (role: 'ADMIN' | 'GENERAL', suffix: string) =>
      prisma.user.create({
        data: {
          name: `테스트 ${suffix}`,
          email: `concurrency-${runId}-${suffix}-${Math.random()}@test.local`,
          role,
          organizationId,
        },
      });

    const [adminA, adminB, user] = await Promise.all([
      createUser('ADMIN', 'a'),
      createUser('ADMIN', 'b'),
      createUser('GENERAL', 'u'),
    ]);
    adminIds = [adminA.id, adminB.id];
    userId = user.id;

    const category = await prisma.category.findFirst({ select: { id: true } });
    const categoryId =
      category?.id ??
      (await prisma.category.create({ data: { name: '테스트' } })).id;

    const product = await prisma.product.create({
      data: {
        name: '테스트 과자',
        price: 3000,
        categoryId,
        createdById: userId,
        organizationId,
      },
    });
    productId = product.id;

    const budget = await prisma.budget.create({
      data: { organizationId, year, month, startingBudget: 10000 },
    });
    budgetId = budget.id;
  });

  afterEach(async () => {
    await prisma.orderItem.deleteMany({ where: { order: { organizationId } } });
    await prisma.order.deleteMany({ where: { organizationId } });
    await prisma.cartItem.deleteMany({
      where: { product: { organizationId } },
    });
    await prisma.idempotencyKey.deleteMany({
      where: { userId: { in: [userId, ...adminIds] } },
    });
    await prisma.product.deleteMany({ where: { organizationId } });
    await prisma.budget.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createPendingOrder(totalPrice: number): Promise<number> {
    const order = await prisma.order.create({
      data: {
        organizationId,
        requesterId: userId,
        totalPrice,
        items: {
          create: [{ productId, quantity: 1, priceAtOrder: totalPrice }],
        },
      },
    });
    return order.id;
  }

  async function spentAmount(): Promise<number> {
    const budget = await prisma.budget.findUniqueOrThrow({
      where: { id: budgetId },
    });
    return budget.spentAmount;
  }

  function codesOf(results: PromiseSettledResult<unknown>[]): string[] {
    return results
      .filter((result) => result.status === 'rejected')
      .map((result) => (result as PromiseRejectedResult).reason?.code)
      .sort();
  }

  test('같은 주문을 두 관리자가 동시에 승인하면 한 번만 승인되고 예산도 한 번만 차감된다', async () => {
    const orderId = await createPendingOrder(4000);

    const results = await Promise.allSettled(
      adminIds.map((adminId) =>
        orderService.approveOrder(orderId, organizationId, adminId, {
          responseMessage: '승인',
        }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(codesOf(results)).toEqual(['ORDER_ALREADY_PROCESSED']);
    expect(await spentAmount()).toBe(4000);
  });

  test('합치면 예산을 넘는 두 주문을 동시에 승인하면 한 건만 승인된다', async () => {
    const orderIds = await Promise.all([
      createPendingOrder(6000),
      createPendingOrder(6000),
    ]);

    const results = await Promise.allSettled(
      orderIds.map((orderId, index) =>
        orderService.approveOrder(orderId, organizationId, adminIds[index], {
          responseMessage: '승인',
        }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(codesOf(results)).toEqual(['BUDGET_EXCEEDED']);
    expect(await spentAmount()).toBe(6000);
    const statuses = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { status: true },
    });
    expect(statuses.map((order) => order.status).sort()).toEqual([
      'APPROVED',
      'PENDING',
    ]);
  });

  test('승인과 요청자 취소가 동시에 들어와도 예산과 주문 상태가 일치한다', async () => {
    const orderId = await createPendingOrder(4000);

    await Promise.allSettled([
      orderService.approveOrder(orderId, organizationId, adminIds[0], {
        responseMessage: '승인',
      }),
      orderService.cancelMyOrder(orderId, userId),
    ]);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(['APPROVED', 'CANCELED']).toContain(order.status);
    expect(await spentAmount()).toBe(order.status === 'APPROVED' ? 4000 : 0);
  });

  test('관리자 즉시 구매를 동시에 여러 번 해도 예산을 넘지 않는다', async () => {
    const carts = await Promise.all(
      adminIds.map((adminId) =>
        prisma.cartItem.create({
          data: { userId: adminId, productId, quantity: 1 },
        }),
      ),
    );

    // 상품 3,000원 × 2개 + 배송비 3,000원 = 9,000원. 두 건이면 18,000원으로 예산(10,000원)을 넘는다.
    const results = await Promise.allSettled(
      carts.map((cart, index) =>
        orderService.createOrder(adminIds[index], organizationId, 'ADMIN', {
          items: [{ cartItemId: cart.id, quantity: 2 }],
        }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(codesOf(results)).toEqual(['BUDGET_EXCEEDED']);
    expect(await spentAmount()).toBe(9000);
  });

  test('같은 장바구니로 구매 요청을 동시에 보내도 주문은 한 건만 생긴다', async () => {
    const cart = await prisma.cartItem.create({
      data: { userId, productId, quantity: 1 },
    });

    await Promise.allSettled(
      [1, 2].map(() =>
        orderService.createOrder(userId, organizationId, 'GENERAL', {
          items: [{ cartItemId: cart.id, quantity: 1 }],
        }),
      ),
    );

    const orderCount = await prisma.order.count({ where: { organizationId } });
    expect(orderCount).toBe(1);
  });

  test('같은 멱등성 키를 동시에 선점하면 한 요청만 처리 권한을 얻는다', async () => {
    const claimData = {
      userId,
      key: `concurrency-${runId}`,
      requestHash: 'same-request',
      expiresAt: new Date(Date.now() + 60_000),
    };

    const results = await Promise.all(
      [1, 2, 3].map(() => idempotencyRepository.claim(claimData)),
    );

    expect(results.filter((result) => result.isNew)).toHaveLength(1);
  });
});
