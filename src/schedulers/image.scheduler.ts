// src/schedulers/image.scheduler.ts
import cron from 'node-cron';

import { findMissingS3Env } from '../config/s3';
import { cleanupOrphanImages } from '../modules/image/image.service';

// 업로드 후 상품 등록을 마치기 전인 이미지를 지우지 않도록 하루 여유를 둔다.
const ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export function startOrphanImageCleanupScheduler(): void {
  // AWS 설정이 없는 로컬 환경에서는 등록하지 않는다. (config/s3.ts 주석 참고)
  const missingEnv = findMissingS3Env();
  if (missingEnv.length > 0) {
    console.log(
      `⏭️ [크론] S3 설정(${missingEnv.join(', ')})이 없어 고아 이미지 정리를 건너뜁니다.`,
    );
    return;
  }

  // 트래픽이 적은 새벽 4시에 실행한다.
  cron.schedule(
    '0 4 * * *',
    async () => {
      try {
        const deletedCount = await cleanupOrphanImages({
          createdBefore: new Date(Date.now() - ORPHAN_GRACE_PERIOD_MS),
        });
        console.log(`✅ [크론] 고아 이미지 ${deletedCount}개를 정리했습니다.`);
      } catch (error) {
        // 실패한 이미지는 기록이 남아 다음 실행에서 다시 시도한다.
        console.error('❌ [크론] 고아 이미지 정리 실패', error);
      }
    },
    {
      timezone: 'Asia/Seoul',
    },
  );
}
