const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const {
  mappingAutomationRoutes,
} = require("../../src/routes/mapping-automation.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

function appFixture() {
  const calls = [];
  const mappingAutomation = {
    importFileItems: async (rows) => ({
      processed: rows.length,
      created: rows.length,
      changed: 0,
    }),
    syncLiveFileItems: async () => ({
      processed: 2,
      created: 1,
      changed: 1,
      metadata: { productsScanned: 20 },
    }),
    listFileItems: async () => ({ items: [], total: 0, page: 1, limit: 50 }),
    listSupplierItems: async (supplierCode) => ({
      supplierCode,
      items: [],
      total: 0,
      page: 1,
      limit: 50,
    }),
    importSupplierItems: async (supplierCode, rows) => ({
      supplierCode,
      processed: rows.length,
      created: rows.length,
      changed: 0,
    }),
    updateSupplierItemPricing: async (supplierCode, id, body) => ({
      id: Number(id),
      supplier_code: supplierCode,
      current_price: body.current_price || 10,
      price_tiers: body.price_tiers || [],
    }),
    syncLiveSupplierItems: async (supplierCode) => ({
      supplierCode,
      processed: 3,
      created: 3,
      changed: 0,
      metadata: { productsScanned: 3 },
    }),
    generate: async () => ({ created: 3, trainingProductCount: 120 }),
    diagnostics: async () => ({ items: [], summary: {}, processed: 0 }),
    regenerateDiagnosticBarcode: async (barcode) => ({
      barcode,
      processed: 1,
      created: 1,
    }),
    markDiagnosticManualCost: async (barcode, actor, body) => ({
      barcode,
      actor,
      reason: body.reason,
    }),
    listSuggestions: async () => ({ items: [], total: 0, page: 1, limit: 50 }),
    listLearningFeedback: async () => ({
      items: [{ id: 1, decision: "APPROVED" }],
      total: 1,
      page: 1,
      limit: 50,
    }),
    getSuggestion: async (id) => ({ id: Number(id), status: "PENDING" }),
    approve: async (id) => ({ id: Number(id), barcode: "1", confidence: 0.95 }),
    reject: async (id, actor, body) => ({
      id: Number(id),
      barcode: "1",
      rejection_reason: body.reason,
    }),
    bulkPreview: async (ids) => ({ token: "token", productCount: ids.length }),
    bulkApply: async (ids, token) => {
      calls.push({ ids, token });
      return { applied: ids.length };
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { username: "admin" };
    req.id = "mapping-automation-test";
    next();
  });
  app.use(
    "/api",
    mappingAutomationRoutes({
      mappingAutomation,
      fileMarket: { livePriceRows: async () => ({ rows: [], stats: {} }) },
      bizimMarket: { livePriceRows: async () => ({ rows: [], stats: {} }) },
      audit: { record: async () => {} },
    }),
  );
  app.use(errorHandler);
  return { app, calls };
}

test("File fiyat havuzu toplu ürün kabul eder", async () => {
  const response = await request(appFixture().app)
    .post("/api/file-market/items/bulk")
    .send({ rows: [{ product_name: "Actisoft", current_price: 112 }] })
    .expect(200);
  assert.equal(response.body.data.processed, 1);
});

test("File fiyat havuzu canlı API üzerinden yenilenir", async () => {
  const response = await request(appFixture().app)
    .post("/api/file-market/items/sync-live")
    .send({})
    .expect(200);
  assert.equal(response.body.data.processed, 2);
  assert.equal(response.body.data.metadata.productsScanned, 20);
});

test("Bizim Toptan ve BİM havuzları ayrı endpointlerden yönetilir", async () => {
  const fixture = appFixture();
  const bizim = await request(fixture.app)
    .post("/api/supplier-price-pools/BIZIM_MARKET/items/sync-live")
    .send({})
    .expect(200);
  assert.equal(bizim.body.data.supplierCode, "BIZIM_MARKET");
  const bim = await request(fixture.app)
    .post("/api/supplier-price-pools/BIM/items/bulk")
    .send({ rows: [{ product_name: "BİM ürünü", current_price: 10 }] })
    .expect(200);
  assert.equal(bim.body.data.supplierCode, "BIM");
});

test("tedarikçi havuzu çoklu fiyat kademesi güncellenebilir", async () => {
  const response = await request(appFixture().app)
    .patch("/api/supplier-price-pools/BIZIM_MARKET/items/7")
    .send({
      current_price: 42.5,
      price_tiers: [{ min_quantity: 6, unit_price: 38.9 }],
    })
    .expect(200);
  assert.equal(response.body.data.supplier_code, "BIZIM_MARKET");
  assert.equal(response.body.data.price_tiers[0].unit_price, 38.9);
});

test("mapping önerisi onayı ile uygulaması ayrı endpointlerdir", async () => {
  const fixture = appFixture();
  await request(fixture.app)
    .post("/api/mapping-suggestions/4/approve")
    .send({ update_file_price: true })
    .expect(200);
  assert.equal(fixture.calls.length, 0);
  await request(fixture.app)
    .post("/api/mapping-suggestions/bulk-apply")
    .send({ ids: [4], previewToken: "token" })
    .expect(200);
  assert.deepEqual(fixture.calls, [{ ids: [4], token: "token" }]);
});

test("mapping karar geçmişi API üzerinden listelenir", async () => {
  const response = await request(appFixture().app)
    .get("/api/mapping-learning/feedback")
    .expect(200);
  assert.equal(response.body.data.total, 1);
  assert.equal(response.body.data.items[0].decision, "APPROVED");
});

test("teşhis satırından tek barkod önerisi yeniden üretilebilir", async () => {
  const response = await request(appFixture().app)
    .post("/api/mapping-suggestions/diagnostics/528528268/regenerate")
    .send({})
    .expect(200);
  assert.equal(response.body.data.barcode, "528528268");
  assert.equal(response.body.data.created, 1);
});

test("teşhis satırı manuel maliyet kuyruğuna alınabilir", async () => {
  const response = await request(appFixture().app)
    .post("/api/mapping-suggestions/diagnostics/528528268/manual-cost")
    .send({ reason: "manuel giriş yapacağım" })
    .expect(200);
  assert.equal(response.body.data.barcode, "528528268");
  assert.equal(response.body.data.reason, "manuel giriş yapacağım");
});
