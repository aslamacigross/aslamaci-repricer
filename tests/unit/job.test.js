const test = require("node:test");
const assert = require("node:assert/strict");
const { JobService, safeItemError } = require("../../src/services/job.service");

test("otomatik repricer ürün-bazlı hatayı güvenli job metadatasına dönüştürür", () => {
  const item = safeItemError(
    { id: 9007199254740993n, barcode: "8690609598109" },
    Object.assign(new Error("token=secret-value ile istek reddedildi"), {
      code: "TRENDYOL_REJECTED",
    }),
  );
  assert.deepEqual(item, {
    actionId: "9007199254740993",
    barcode: "8690609598109",
    errorCode: "TRENDYOL_REJECTED",
    message: "token=[REDACTED] ile istek reddedildi",
  });
});

test("advisory lock alinmazsa ayni job ikinci kez calismaz", async () => {
  let handled = 0;
  const client = {
    query: async () => ({ rows: [{ locked: false }] }),
    release() {},
  };
  const service = new JobService({
    db: { connect: async () => client },
    repository: {},
  });
  service.register("sync", async () => {
    handled++;
  });
  const result = await service.run("sync");
  assert.equal(result.status, "SKIPPED");
  assert.equal(handled, 0);
});

test("job diagnostic metadata mevcut run kaydına taşınır", async () => {
  const finished = [];
  const client = {
    async query(sql) {
      if (sql.includes("pg_try_advisory_lock"))
        return { rows: [{ locked: true }] };
      return { rows: [] };
    },
    release() {},
  };
  const service = new JobService({
    db: { connect: async () => client },
    repository: {
      start: async () => ({ id: 7 }),
      finish: async (id, result) => {
        finished.push({ id, result });
        return result;
      },
    },
  });
  service.register("sync-rossmann-market-prices", async () => {
    const error = new Error("Rossmann katalog 403: Forbidden");
    error.jobDiagnostics = {
      failureStage: "http_response",
      httpStatus: 403,
      page: 1,
      attempt: 1,
    };
    throw error;
  });

  await assert.rejects(
    service.run("sync-rossmann-market-prices"),
    /Rossmann katalog 403/,
  );
  assert.deepEqual(finished, [
    {
      id: 7,
      result: {
        status: "FAILED",
        error: "Rossmann katalog 403: Forbidden",
        metadata: {
          failureStage: "http_response",
          httpStatus: 403,
          page: 1,
          attempt: 1,
        },
      },
    },
  ]);
});

test("scheduler lock sonrasında job artık due değilse stale kararla çalıştırmaz", async () => {
  let handled = 0;
  let started = 0;
  const client = {
    async query(sql) {
      if (sql.includes("pg_try_advisory_lock"))
        return { rows: [{ locked: true }] };
      if (sql.includes("FROM jobs WHERE name"))
        return {
          rows: [
            {
              name: "sync-buybox",
              enabled: true,
              schedule_type: "INTERVAL",
              schedule_minutes: 60,
              last_run_at: new Date().toISOString(),
            },
          ],
        };
      return { rows: [] };
    },
    release() {},
  };
  const service = new JobService({
    db: { connect: async () => client },
    repository: {
      start: async () => {
        started++;
        return { id: 1 };
      },
    },
  });
  service.register("sync-buybox", async () => {
    handled++;
  });

  const result = await service.run("sync-buybox", { source: "scheduler" });

  assert.equal(result.status, "SKIPPED");
  assert.equal(handled, 0);
  assert.equal(started, 0);
});

test("scheduler lock sonrasında hâlâ due olan jobu normal çalıştırır", async () => {
  let handled = 0;
  const client = {
    async query(sql) {
      if (sql.includes("pg_try_advisory_lock"))
        return { rows: [{ locked: true }] };
      if (sql.includes("FROM jobs WHERE name"))
        return {
          rows: [
            {
              name: "sync-buybox",
              enabled: true,
              schedule_type: "INTERVAL",
              schedule_minutes: 1,
              last_run_at: "2026-09-25T08:00:00.000Z",
            },
          ],
        };
      return { rows: [] };
    },
    release() {},
  };
  const service = new JobService({
    db: { connect: async () => client },
    repository: {
      start: async () => ({ id: 1 }),
      finish: async (_id, result) => result,
    },
  });
  service.register("sync-buybox", async () => {
    handled++;
    return { processed: 1, successful: 1, failed: 0 };
  });

  const result = await service.run("sync-buybox", { source: "scheduler" });

  assert.equal(result.status, "SUCCESS");
  assert.equal(handled, 1);
});
