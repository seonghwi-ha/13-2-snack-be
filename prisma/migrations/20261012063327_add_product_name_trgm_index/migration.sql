-- 상품명 부분 일치·오타 검색용 트라이그램 확장
-- 운영 DB(RDS 등)에서 확장 생성 권한이 있는 계정으로 실행해야 한다.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
