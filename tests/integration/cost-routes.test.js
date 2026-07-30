const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { costsRoutes } = require("../../src/routes/costs.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

function appFixture() {
  let fullReplaceCalls = 0;
  const bulkCostCalls = [];
  const manualReviewUpdates = [];
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
        saveCostItems: async (rows) => {
          bulkCostCalls.push(rows);
          return { processed: rows.length, items: rows };
        },
        duplicateCostItemCandidates: async () => ({
          total: 1,
          items: [
            {
              score: 0.98,
              reasons: ["VERY_SIMILAR_NAME"],
              left: { item_code: "A" },
              right: { item_code: "B" },
            },
          ],
        }),
        manualCostReviewQueue: async () => ({
          total: 1,
          page: 1,
          limit: 50,
          items: [{ id: 1, item_code: "MANUEL", due: true }],
        }),
        confirmManualCostReview: async (id, input) => {
          manualReviewUpdates.push({ type: "confirm", id, input });
          return { id, item_code: "MANUEL", unit_cost: 10 };
        },
        updateManualCostReview: async (id, input) => {
          manualReviewUpdates.push({ type: "update", id, input });
          return { id, item_code: "MANUEL", unit_cost: input.unit_cost };
        },
        linkManualCostToSupplierItem: async (id, supplierItemId, input) => {
          manualReviewUpdates.push({
            type: "link",
            id,
            supplierItemId,
            input,
          });
          return {
            costItem: { id, item_code: "MANUEL", unit_cost: 49.9 },
            supplierItem: {
              id: supplierItemId,
              supplier_code: "FILE_MARKET",
              product_name: "Actisoft",
              current_price: 49.9,
            },
          };
        },
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
  return {
    app,
    fullReplaceCalls: () => fullReplaceCalls,
    bulkCostCalls,
    manualReviewUpdates,
  };
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

test("toplu maliyet satirlarini once tamamen dogrular", async () => {
  const fixture = appFixture();
  await request(fixture.app)
    .post("/api/cost-items/bulk")
    .send({
      rows: [
        {
          item_code: "A",
          item_name: "Geçerli",
          unit_cost: 10,
          unit_desi: 1,
        },
        {
          item_code: "B",
          item_name: "Hatalı",
          unit_cost: 0,
          unit_desi: 1,
        },
      ],
    })
    .expect(400);
  assert.equal(fixture.bulkCostCalls.length, 0);
});

test("gecerli toplu maliyet satirlarini tek repository cagrisi ile kaydeder", async () => {
  const fixture = appFixture();
  const response = await request(fixture.app)
    .post("/api/cost-items/bulk")
    .send({
      rows: [
        {
          item_code: "A",
          item_name: "Kalem A",
          unit_cost: 10.25,
          unit_desi: 1.5,
          unit: "adet",
        },
      ],
    })
    .expect(200);
  assert.equal(response.body.data.processed, 1);
  assert.equal(fixture.bulkCostCalls.length, 1);
  assert.equal(fixture.bulkCostCalls[0][0].item_code, "A");
});

test("maliyet kalemi tekrar adaylari ayri endpointten listelenir", async () => {
  const response = await request(appFixture().app)
    .get("/api/cost-items/duplicates")
    .expect(200);
  assert.equal(response.body.data.total, 1);
  assert.equal(response.body.data.items[0].left.item_code, "A");
});

test("manuel maliyet kontrol listesi ayri endpointten gelir", async () => {
  const response = await request(appFixture().app)
    .get("/api/cost-items/manual-review")
    .expect(200);
  assert.equal(response.body.data.total, 1);
  assert.equal(response.body.data.items[0].item_code, "MANUEL");
});

test("manuel maliyet ayni kalsin onayi kaydedilir", async () => {
  const fixture = appFixture();
  const response = await request(fixture.app)
    .post("/api/cost-items/manual-review/1/confirm")
    .send({ note: "Kontrol edildi" })
    .expect(200);
  assert.equal(response.body.data.id, "1");
  assert.equal(fixture.manualReviewUpdates[0].type, "confirm");
});

test("manuel maliyet guncelleme maliyet dogrulamasi yapar", async () => {
  const fixture = appFixture();
  await request(fixture.app)
    .patch("/api/cost-items/manual-review/1")
    .send({ unit_cost: 0 })
    .expect(400);
  assert.equal(fixture.manualReviewUpdates.length, 0);

  const response = await request(fixture.app)
    .patch("/api/cost-items/manual-review/1")
    .send({ unit_cost: 88, unit_desi: 1, note: "Yeni fiyat" })
    .expect(200);
  assert.equal(response.body.data.unit_cost, 88);
  assert.equal(fixture.manualReviewUpdates[0].type, "update");
});

test("manuel maliyet canlı tedarikci havuzuna baglanabilir", async () => {
  const fixture = appFixture();
  await request(fixture.app)
    .post("/api/cost-items/manual-review/1/link-supplier")
    .send({ supplierItemId: 0 })
    .expect(400);
  assert.equal(fixture.manualReviewUpdates.length, 0);

  const response = await request(fixture.app)
    .post("/api/cost-items/manual-review/1/link-supplier")
    .send({ supplierItemId: 99, note: "File adayı" })
    .expect(200);
  assert.equal(response.body.data.costItem.unit_cost, 49.9);
  assert.equal(fixture.manualReviewUpdates[0].type, "link");
  assert.equal(fixture.manualReviewUpdates[0].supplierItemId, 99);
});
