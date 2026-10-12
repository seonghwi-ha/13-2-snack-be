import 'dotenv/config';

import app from './app';
import {
  createMonthlyBudgetsOnStartup,
  startBudgetScheduler,
} from './schedulers/budget.scheduler';
import { startOrphanImageCleanupScheduler } from './schedulers/image.scheduler';

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  try {
    //cron이 작동했었어야할 월간에 서버가 꺼졌다 켜졌을 시 해당 함수로 새 Budget 데이터 생성
    await createMonthlyBudgetsOnStartup();

    //서버가 정상적으로 계속 켜져있었을 시에는 cron으로 새 Budget 데이터 생성
    startBudgetScheduler();

    // 상품에 연결되지 않은 S3 이미지를 매일 정리
    startOrphanImageCleanupScheduler();

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Swagger docs on http://localhost:${PORT}/docs`);
    });
  } catch (error) {
    //Budget 데이터 생성 실패 시 에러
    console.error('Failed to initialize monthly budgets:', error);
    process.exit(1);
  }
}

startServer();
