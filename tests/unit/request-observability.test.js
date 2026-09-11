const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const {
  createRequestObservability,
} = require("../../src/middleware/request-observability");
const {
  recordDatabaseQuery,
  createRequestMetrics,
  runWithRequestMetrics,
  observeDatabase,
} = require("../../src/observability/request-metrics");

test("request metriği süre, DB kullanımı ve response boyutunu body loglamadan yazar", async () => {
  const entries = [];
  let currentTime = 100;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.id = "request-1";
    next();
  });
  app.use(
    createRequestObservability({
      log: {
        info: (message, data) => entries.push({ level: "info", message, data }),
        warn: (message, data) => entries.push({ level: "warn", message, data }),
      },
      clock: () => currentTime,
      random: () => 0,
      normalSampleRate: 1,
    }),
  );
  app.post("/api/cost-items", (req, res) => {
    recordDatabaseQuery(125.4);
    recordDatabaseQuery(74.6);
    currentTime = 850;
    res.json({ ok: true });
  });

  await request(app)
    .post("/api/cost-items?token=query-secret")
    .set("Authorization", "Bearer header-secret")
    .set("Cookie", "session=cookie-secret")
    .send({ password: "body-secret" })
    .expect(200);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, "warn");
  assert.equal(entries[0].message, "http_request_metric");
  assert.deepEqual(entries[0].data, {
    request_id: "request-1",
    method: "POST",
    route: "/api/cost-items",
    status: 200,
    duration_ms: 750,
    db_time_ms: 200,
    query_count: 2,
    response_bytes: Buffer.byteLength(JSON.stringify({ ok: true })),
    performance: "slow",
  });
  const serialized = JSON.stringify(entries);
  for (const secret of [
    "query-secret",
    "header-secret",
    "cookie-secret",
    "body-secret",
  ])
    assert.equal(serialized.includes(secret), false);
});

test("database wrapper request context içinde pool ve client sorgularını sayar", async () => {
  const client = {
    async query() {
      return { rows: [] };
    },
    release() {},
  };
  const database = observeDatabase({
    async query() {
      return { rows: [] };
    },
    async connect() {
      return client;
    },
  });
  const metrics = createRequestMetrics();

  await runWithRequestMetrics(metrics, async () => {
    await database.query("SELECT 1");
    const connection = await database.connect();
    await connection.query("SELECT 2");
  });

  assert.equal(metrics.queryCount, 2);
  assert.equal(metrics.dbTimeMs >= 0, true);
});
