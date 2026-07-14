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
    listFileItems: async () => ({ items: [], total: 0, page: 1, limit: 50 }),
    generate: async () => ({ created: 3, trainingProductCount: 120 }),
    listSuggestions: async () => ({ items: [], total: 0, page: 1, limit: 50 }),
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
