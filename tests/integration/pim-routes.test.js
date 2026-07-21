const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { pimRoutes } = require("../../src/routes/pim.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

function appWith(pim) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { username: "admin" };
    req.id = "pim-test";
    next();
  });
  app.use("/api", pimRoutes({ pim, audit: { record: async () => {} } }));
  app.use(errorHandler);
  return app;
}

test("PIM bootstrap açık onay olmadan uygulanmaz", async () => {
  let applied = false;
  const app = appWith({
    bootstrap: async () => {
      applied = true;
      return {};
    },
  });
  const response = await request(app).post("/api/pim/bootstrap/apply").send({});
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "PIM_BOOTSTRAP_CONFIRMATION_REQUIRED");
  assert.equal(applied, false);
});

test("listing barkodu yalnız açık onayla tahsis edilir", async () => {
  const calls = [];
  const app = appWith({
    allocateBarcode: async (input) => {
      calls.push(input);
      return {
        id: 1,
        marketplace: "HEPSIBURADA",
        barcode: "ASL-HEP-1",
        status: "RESERVED",
      };
    },
  });
  const response = await request(app)
    .post("/api/listing-barcodes/allocate")
    .send({
      marketplace: "HEPSIBURADA",
      recipeId: 9,
      confirmation: "LISTING_BARKODU_TAHSIS_ET",
    });
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(response.body.data.status, "RESERVED");
});

test("katalog eşleşme önizlemesi pazaryeri mutasyonu yapmaz", async () => {
  const app = appWith({
    previewCatalogMatches: async () => [
      { confidence: 95, status: "REVIEW_REQUIRED" },
    ],
  });
  const response = await request(app)
    .post("/api/catalog-matches/preview")
    .send({ recipeId: 1, candidates: [] });
  assert.equal(response.status, 200);
  assert.equal(response.body.items[0].status, "REVIEW_REQUIRED");
});
