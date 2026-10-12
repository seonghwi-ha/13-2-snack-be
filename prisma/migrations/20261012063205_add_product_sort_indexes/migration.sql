-- CreateIndex
CREATE INDEX "Product_organizationId_createdAt_id_idx" ON "Product"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Product_organizationId_purchaseCount_id_idx" ON "Product"("organizationId", "purchaseCount", "id");

-- CreateIndex
CREATE INDEX "Product_organizationId_price_id_idx" ON "Product"("organizationId", "price", "id");
