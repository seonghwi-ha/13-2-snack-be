import { prisma } from '../../config/prisma';

type CreateData = {
  key: string;
  uploadedById: number;
  organizationId: number;
};

export type ImageOwner = {
  uploadedById: number;
  organizationId: number;
} | null;

// 상품은 imageUrl(`<API_BASE>/images/<key>`)만 들고 있다.
// API_BASE는 배포 환경마다 다를 수 있어 앞부분은 보지 않고 key로 끝나는지만 본다.
function imageUrlSuffix(key: string): string {
  return `/images/${key}`;
}

export function create(data: CreateData): Promise<{ id: number }> {
  return prisma.image.create({ data, select: { id: true } });
}

export function findOwnerByKey(key: string): Promise<ImageOwner> {
  return prisma.image.findUnique({
    where: { key },
    select: { uploadedById: true, organizationId: true },
  });
}

/**
 * 이미지 기록을 지우고, 같은 조직에서 그 이미지를 쓰던 상품의 imageUrl도 비운다.
 * S3 파일이 없어진 뒤 상품 카드가 깨진 이미지를 가리키지 않게 하려는 것이다.
 * 기록이 없는 예전 업로드도 상품 정리는 해야 해서 deleteMany로 지운다.
 */
export async function deleteByKey(
  key: string,
  organizationId: number,
): Promise<void> {
  await prisma.$transaction([
    prisma.product.updateMany({
      where: { organizationId, imageUrl: { endsWith: imageUrlSuffix(key) } },
      data: { imageUrl: null },
    }),
    prisma.image.deleteMany({ where: { key } }),
  ]);
}

// 올린 지 오래됐는데 상품에 연결되지 않은 이미지 후보. 오래된 것부터 batchSize개씩 본다.
export function findCreatedBefore(
  createdBefore: Date,
  batchSize: number,
  afterId = 0,
): Promise<{ id: number; key: string }[]> {
  return prisma.image.findMany({
    where: { createdAt: { lt: createdBefore }, id: { gt: afterId } },
    select: { id: true, key: true },
    orderBy: { id: 'asc' },
    take: batchSize,
  });
}

/**
 * 주어진 key 중 상품이 쓰고 있는 key만 돌려준다.
 * 소프트 삭제된 상품도 구매 내역 화면에서 이미지를 보여주므로 사용 중으로 본다.
 */
export async function findKeysInUse(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();

  const products = await prisma.product.findMany({
    where: {
      OR: keys.map((key) => ({
        imageUrl: { endsWith: imageUrlSuffix(key) },
      })),
    },
    select: { imageUrl: true },
  });

  return new Set(
    keys.filter((key) =>
      products.some((product) =>
        product.imageUrl?.endsWith(imageUrlSuffix(key)),
      ),
    ),
  );
}

export async function deleteManyByKeys(keys: string[]): Promise<number> {
  const result = await prisma.image.deleteMany({
    where: { key: { in: keys } },
  });

  return result.count;
}
