const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { systemRoutes } = require("../../src/routes/system.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

function createFixture() {
  const values = {
    global_dry_run: true,
    global_repricer_enabled: false,
  };
  const writes = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { username: "admin" };
    req.id = "test-request";
    next();
  });
  app.use(
    "/api",
    systemRoutes({
      db: { query: async () => ({ rows: [] }) },
      products: {},
      jobs: {},
      jobService: {},
      settings: {
        getAll: async () => ({ ...values }),
        set: async (key, value) => {
          values[key] = value;
          writes.push([key, value]);
          return { key, value };
        },
      },
      audit: { record: async () => {} },
      sheets: {},
      sync: {},
      costEngine: { recalculate: async () => ({ processed: 0 }) },
    }),
  );
  app.use(errorHandler);
  return { app, writes };
}

test("dry-run acik durumdan kapatilirken acik onay zorunludur", async () => {
  const { app, writes } = createFixture();
  const blocked = await request(app)
    .patch("/api/settings")
    .send({ global_dry_run: false });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "LIVE_MODE_CONFIRMATION_REQUIRED");
  assert.equal(writes.length, 0);

  const approved = await request(app).patch("/api/settings").send({
    global_dry_run: false,
    confirmation: "CANLI_FIYAT_MODUNU_AC",
  });
  assert.equal(approved.status, 200);
  assert.deepEqual(writes, [["global_dry_run", false]]);
});

test("boolean sistem ayari string ile degistirilemez", async () => {
  const { app, writes } = createFixture();
  const response = await request(app)
    .patch("/api/settings")
    .send({ global_dry_run: "false" });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
  assert.equal(writes.length, 0);
});

test("gecersiz coklu ayar istegi kismi guncelleme yapmaz", async () => {
  const { app, writes } = createFixture();
  const response = await request(app).patch("/api/settings").send({
    default_target_profit: 55,
    default_carrier: "",
  });
  assert.equal(response.status, 400);
  assert.equal(writes.length, 0);
});
