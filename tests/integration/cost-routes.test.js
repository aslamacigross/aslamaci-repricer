const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { costsRoutes } = require("../../src/routes/costs.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

function appFixture() {
  let fullReplaceCalls = 0;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { username: "admin" };
    req.id = "cost-route-test";
    next();
  });
  app.use(
    "/api",
    costsRoutes({
      costs: {
        replaceMappings: async () => {
          fullReplaceCalls++;
          return { replaced: 1 };
        },
        previewMappings: async () => ({
          valid: true,
          products: [{ barcode: "1", product_cost: 112, desi: 1.5 }],
        }),
      },
      costEngine: { recalculate: async () => ({ processed: 0 }) },
      shippingService: {},
      audit: {
        record: async () => {},
        entityHistory: async () => [],
      },
    }),
  );
  app.use(errorHandler);
  return { app, fullReplaceCalls: () => fullReplaceCalls };
}

test("tam mapping replace acik onay olmadan calismaz", async () => {
  const fixture = appFixture();
  const response = await request(fixture.app)
    .post("/api/mappings/bulk")
    .send({ rows: [{ barcode: "1", cost_item_code: "A", quantity: 1 }] });
  assert.equal(response.status, 409);
  assert.equal(
    response.body.code,
    "FULL_MAPPING_REPLACE_CONFIRMATION_REQUIRED",
  );
  assert.equal(fixture.fullReplaceCalls(), 0);
});

test("mapping onizleme kaydetmeden maliyet ve desi dondurur", async () => {
  const response = await request(appFixture().app)
    .post("/api/mappings/preview")
    .send({ rows: [{ barcode: "1", cost_item_code: "A", quantity: 1 }] });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.products[0].product_cost, 112);
  assert.equal(response.body.data.products[0].desi, 1.5);
});
