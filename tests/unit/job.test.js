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
