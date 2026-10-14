// src/schedulers/idempotency.scheduler.ts
import cron from 'node-cron';

import { deleteExpired } from '../modules/idempotency/idempotency.repository';

// 만료된 멱등성 키를 지운다. 만료된 키는 다시 쓰일 때도 지워지므로(claim) 테이블 크기 관리용이다.
export function startExpiredIdempotencyKeyCleanupScheduler(): void {
  cron.schedule(
    '30 4 * * *',
    async () => {
      try {
        const deletedCount = await deleteExpired(new Date());
        console.log(
          `✅ [크론] 만료된 멱등성 키 ${deletedCount}개를 정리했습니다.`,
        );
      } catch (error) {
        console.error('❌ [크론] 만료된 멱등성 키 정리 실패', error);
      }
    },
    {
      timezone: 'Asia/Seoul',
    },
  );
}
