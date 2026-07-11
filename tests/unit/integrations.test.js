const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GoogleSheetsService,
} = require("../../src/services/google-sheets.service");
const { TrendyolService } = require("../../src/services/trendyol.service");
const { SheetsSyncService } = require("../../src/services/sheets-sync.service");
test("Google retry gecici premature close hatasindan sonra toparlanir", async () => {
  const service = new GoogleSheetsService({ maxAttempts: 3 });
  let attempts = 0;
  const result = await service.retry(async () => {
    attempts++;
    if (attempts === 1) throw new Error("Premature close");
    return "ok";
  }, "test");
  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});
test("Google request timeout sonsuza kadar beklemez", async () => {
  const service = new GoogleSheetsService({ timeoutMs: 20 });
  const started = Date.now();
  await assert.rejects(
    service.withTimeout(
      (signal) =>
        new Promise((resolve, reject) =>
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          }),
        ),
      "test",
    ),
    /timeout/,
  );
  assert.ok(Date.now() - started < 200);
});
test("es zamanli Google cagrilari tek token yenilemesini paylasir", async () => {
  let calls = 0;
  const service = new GoogleSheetsService({
    fetch: async () => {
      calls++;
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ access_token: "token", expires_in: 3600 }),
      };
    },
  });
  service.signJwt = () => "signed";
  const [first, second] = await Promise.all([
    service.getToken(),
    service.getToken(),
  ]);
  assert.equal(first, "token");
  assert.equal(second, "token");
  assert.equal(calls, 1);
});
test("Sheet okuma hatasinda transaction baslamaz ve DB korunur", async () => {
  let transactionCount = 0;
  const service = new SheetsSyncService({
    db: {},
    withTransaction: async () => {
      transactionCount++;
    },
    sheets: {
      values: async () => {
        throw new Error("Google unavailable");
      },
    },
    costEngine: {},
    audit: { integration: async () => {} },
  });
  await assert.rejects(service.importAll(), /Google unavailable/);
  assert.equal(transactionCount, 0);
});
test("Trendyol dry-run hic HTTP cagrisi yapmaz", async () => {
  let calls = 0;
  const service = new TrendyolService({
    fetch: async () => {
      calls++;
    },
  });
  const result = await service.updatePrices(
    [{ barcode: "1", salePrice: 100 }],
    { dryRun: true },
  );
  assert.equal(result.dryRun, true);
  assert.equal(calls, 0);
});
test("Sheet export yeni veriyi yazmadan eski satirlari temizlemez", async () => {
  const operations = [];
  const service = new SheetsSyncService({
    db: {
      query: async () => ({
        rows: [{ barcode: "1", product_name: "Urun", updated_at: new Date() }],
      }),
    },
    withTransaction: async () => {},
    sheets: {
      values: async () => ({ values: [["Barkod"], ["1"], ["stale"]] }),
      update: async () => operations.push("update"),
      clear: async (range) => operations.push(`clear:${range}`),
    },
    costEngine: {},
    audit: {},
  });
  await service.exportProducts();
  assert.deepEqual(operations, ["update", "clear:Urunler!A3:T3"]);
});
