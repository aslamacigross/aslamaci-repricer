const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { costsRoutes } = require("../../src/routes/costs.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

function appFixture() {
  let saved;
  let shippingQuery;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { username: "admin" };
    req.id = "shipping-test";
    next();
  });
  app.use(
    "/api",
    costsRoutes({
      costs: {
        shippingPage: async (query) => {
          shippingQuery = query;
          return {
            marketplace: query.marketplace,
            rates: [],
            barems: [],
            packaging: [],
            carriers: [],
            pagination: { page: 1, limit: 50, total: 0 },
          };
        },
        saveShippingRate: async (input) => {
          saved = input;
          return { id: 1, ...input };
        },
      },
      costEngine: { recalculate: async () => ({ processed: 0 }) },
      audit: { record: async () => {} },
    }),
  );
  app.use(errorHandler);
  return {
    app,
    saved: () => saved,
    shippingQuery: () => shippingQuery,
  };
}

test("kargo listesi pazaryeri ve sayfalama filtresini iletir", async () => {
  const fixture = appFixture();
  const response = await request(fixture.app).get(
    "/api/shipping?marketplace=HEPSIBURADA&page=3&limit=50&carrier=Aras&desi=12",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.shippingQuery(), {
    marketplace: "HEPSIBURADA",
    page: "3",
    limit: "50",
    carrier: "Aras",
    desi: "12",
  });
});

test("kargo tarifesinde sifir desi kaydi kabul edilir", async () => {
  const fixture = appFixture();
  const response = await request(fixture.app).post("/api/shipping/rates").send({
    desi_kg: 0,
    carrier: "TEX",
    cost_ex_vat: 77.54,
    vat_rate: 20,
  });
  assert.equal(response.status, 200);
  assert.equal(fixture.saved().desi_kg, 0);
});
