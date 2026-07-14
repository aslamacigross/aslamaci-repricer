const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GoogleSheetsService,
} = require("../../src/services/google-sheets.service");
const { TrendyolService } = require("../../src/services/trendyol.service");
const { SheetsSyncService } = require("../../src/services/sheets-sync.service");
const { SyncService } = require("../../src/services/sync.service");
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
test("Sheet uyumluluk katmani guvenli varsayimlari uygular", () => {
  const service = new SheetsSyncService({});
  const parsed = {
    costItems: service.parseCostItems([
      ["Cost Code", "Maliyet Kalemi", "Birim Maliyet", "Birim Desi"],
      ["COST-1", "Eksik fiyatli kalem", "", 1],
    ]),
    mappings: service.parseMappings([
      ["Barkod", "Cost Code", "Adet"],
      ["8690609598109", "COST-1", ""],
      ["8690609598109", "COST-1", 1],
    ]),
    commissions: service.parseCommissions([
      ["Kategori ID", "Komisyon Orani", "Kategori"],
      [2354, 17, "Yumuşatıcı"],
      [2354, 17, "yumuşatıcı"],
    ]),
    shipping: service.parseShipping([
      ["Desi/KG", "TEX"],
      [0, 77.54],
    ]),
    barems: service.parseBarems([
      ["Min Sepet", "Max Sepet", "Barem", "TEX"],
      [0, 199.99, "BAREM", 34.16],
    ]),
    packaging: service.parsePackaging([
      ["Min Desi", "Max Desi", "Ambalaj"],
      [0, 1, 5],
    ]),
  };

  const normalized = service.normalize(parsed);

  assert.deepEqual(normalized.errors, []);
  assert.deepEqual(service.validate(normalized.data), []);
  assert.equal(normalized.data.costItems[0].unit_cost, 0);
  assert.equal(normalized.data.mappings[0].quantity, 1);
  assert.equal(normalized.data.mappings.length, 1);
  assert.equal(normalized.data.commissions.length, 1);
  assert.equal(normalized.data.shipping[0].desi_kg, 0);
  assert.deepEqual(
    new Set(normalized.warnings.map((warning) => warning.code)),
    new Set([
      "MISSING_UNIT_COST_IMPORTED_AS_ZERO",
      "MISSING_QUANTITY_DEFAULTED",
      "DUPLICATE_IGNORED",
    ]),
  );
});
test("Sheet celiskili tekrarinda transaction baslamaz", async () => {
  let transactionCount = 0;
  const ranges = {
    "MaliyetIndex!A1:F": [
      ["Cost Code", "Maliyet Kalemi", "Birim Maliyet", "Birim Desi"],
      ["COST-1", "Kalem", 10, 1],
    ],
    "UrunMaliyetMap!A1:D": [
      ["Barkod", "Cost Code", "Adet"],
      ["8690609598109", "COST-1", 1],
      ["8690609598109", "COST-1", 2],
    ],
    "KomisyonKurallari!A1:D": [
      ["Kategori ID", "Komisyon Orani", "Kategori"],
      [2354, 17, "Yumuşatıcı"],
    ],
    "KargoMaliyetleri!A1:K": [
      ["Desi/KG", "TEX"],
      [1, 77.54],
    ],
    "KargoBarem!A1:J": [
      ["Min Sepet", "Max Sepet", "Barem", "TEX"],
      [0, 199.99, "BAREM", 34.16],
    ],
    "AmbalajKurallari!A1:D": [
      ["Min Desi", "Max Desi", "Ambalaj"],
      [0, 1, 5],
    ],
  };
  const service = new SheetsSyncService({
    withTransaction: async () => {
      transactionCount++;
    },
    sheets: { values: async (range) => ({ values: ranges[range] }) },
    audit: { integration: async () => {} },
  });

  await assert.rejects(
    service.importAll(),
    (error) =>
      error.code === "SHEETS_VALIDATION_FAILED" &&
      error.details.some((detail) => detail.code === "CONFLICTING_DUPLICATE"),
  );
  assert.equal(transactionCount, 0);
});
test("Sheet import ve maliyet hesabi ayni transaction icinde tamamlanir", async () => {
  let recalculateCount = 0;
  const values = {
    "MaliyetIndex!A1:F": [
      ["Cost Code", "Maliyet Kalemi", "Birim Maliyet", "Birim Desi"],
      ["COST-1", "Kalem", 10, 1],
    ],
    "UrunMaliyetMap!A1:D": [
      ["Barkod", "Cost Code", "Adet"],
      ["8690609598109", "COST-1", 1],
    ],
    "KomisyonKurallari!A1:D": [
      ["Kategori ID", "Komisyon Orani", "Kategori"],
      [2354, 17, "Yumuşatıcı"],
    ],
    "KargoMaliyetleri!A1:K": [
      ["Desi/KG", "TEX"],
      [0, 77.54],
      [1, 77.54],
    ],
    "KargoBarem!A1:J": [
      ["Min Sepet", "Max Sepet", "Barem", "TEX"],
      [0, 199.99, "BAREM", 34.16],
    ],
    "AmbalajKurallari!A1:D": [
      ["Min Desi", "Max Desi", "Ambalaj"],
      [0, 1, 5],
    ],
  };
  const client = {
    query: async (sql) => {
      if (sql.includes("SELECT item_code FROM cost_items"))
        return { rows: [{ item_code: "COST-1" }] };
      if (sql.includes("SELECT barcode FROM products"))
        return { rows: [{ barcode: "8690609598109" }] };
      return { rows: [], rowCount: 1 };
    },
  };
  const service = new SheetsSyncService({
    withTransaction: async (work) => work(client),
    sheets: { values: async (range) => ({ values: values[range] }) },
    costEngine: {
      recalculate: async (barcode, queryable) => {
        assert.equal(barcode, undefined);
        assert.equal(queryable, client);
        recalculateCount++;
      },
    },
    audit: { integration: async () => {} },
  });

  const result = await service.importAll();

  assert.equal(recalculateCount, 1);
  assert.equal(result.processed, 7);
  assert.equal(result.metadata.warningCount, 0);
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
test("Trendyol fiyat servisi canli modda dogru endpoint ve payload kullanir", async () => {
  let request;
  const service = new TrendyolService({
    baseUrl: "https://trendyol.test/integration",
    fetch: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        text: async () => JSON.stringify({ batchRequestId: "batch-1" }),
      };
    },
  });
  const result = await service.updatePrices(
    [{ barcode: "8690609598109", salePrice: 312.28, listPrice: 312.28 }],
    { dryRun: false },
  );
  assert.equal(result.batchRequestId, "batch-1");
  assert.match(request.url, /products\/price-and-inventory$/);
  assert.deepEqual(JSON.parse(request.options.body), {
    items: [
      {
        barcode: "8690609598109",
        salePrice: 312.28,
        listPrice: 312.28,
      },
    ],
  });
});
test("Trendyol tekil urun fiyati barkod filtresiyle okunur", async () => {
  let requestedUrl;
  const service = new TrendyolService({
    baseUrl: "https://trendyol.test/integration",
    fetch: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            page: 0,
            totalPages: 1,
            content: [
              {
                title: "Menekşe Konsantre Yumuşatıcı",
                brand: { id: 1, name: "Actisoft" },
                category: { id: 2354, name: "Yumuşatıcı" },
                variants: [
                  {
                    barcode: "8690609598109",
                    price: { salePrice: 312.28, listPrice: 320 },
                    stock: { quantity: 4 },
                    onSale: true,
                    archived: false,
                    locked: false,
                  },
                ],
              },
            ],
          }),
      };
    },
  });
  const product = await service.getProductByBarcode("8690609598109");
  assert.equal(product.salePrice, 312.28);
  assert.equal(product.quantity, 4);
  assert.equal(product.brand, "Actisoft");
  assert.equal(product.categoryId, 2354);
  assert.equal(product.onSale, true);
  assert.match(requestedUrl, /barcode=8690609598109/);
  assert.match(requestedUrl, /products\/approved/);
});
test("urun sync sadece gercekten satilabilir urunleri aktif tutar", async () => {
  const queries = [];
  const sync = new SyncService({
    audit: {},
    trendyol: {
      listProducts: async () => ({
        last: true,
        content: [
          {
            barcode: "ACTIVE",
            title: "Aktif ürün",
            salePrice: 100,
            listPrice: 100,
            quantity: 2,
            archived: false,
            locked: false,
            onSale: true,
            approved: true,
          },
          {
            barcode: "NO_STOCK",
            title: "Stoksuz ürün",
            salePrice: 100,
            listPrice: 100,
            quantity: 0,
            archived: false,
            locked: false,
            onSale: true,
            approved: true,
          },
          {
            barcode: "NOT_ON_SALE",
            title: "Satışta olmayan ürün",
            salePrice: 100,
            listPrice: 100,
            quantity: 2,
            archived: false,
            locked: false,
            onSale: false,
            approved: true,
          },
        ],
      }),
    },
    db: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    },
  });

  const result = await sync.products();
  assert.equal(result.processed, 3);
  const upserts = queries.filter((query) =>
    String(query.sql).includes("INSERT INTO products"),
  );
  assert.equal(upserts[0].params[13], true);
  assert.equal(upserts[1].params[13], false);
  assert.equal(upserts[2].params[13], false);
  const staleUpdate = queries.find((query) =>
    String(query.sql).includes("NOT (barcode=ANY"),
  );
  assert.deepEqual(staleUpdate.params[0], [
    "ACTIVE",
    "NO_STOCK",
    "NOT_ON_SALE",
  ]);
});
test("Trendyol GET istegi gecici hatada geri cekilmeyle yeniden denenir", async () => {
  let calls = 0;
  const delays = [];
  const service = new TrendyolService({
    retryAttempts: 3,
    retryBaseDelayMs: 5,
    sleep: async (ms) => delays.push(ms),
    fetch: async () => {
      calls++;
      if (calls < 3)
        return { ok: false, status: 503, text: async () => "temporary" };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [] }),
      };
    },
  });
  const result = await service.getBatchResult("batch-1");
  assert.deepEqual(result, { items: [] });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5, 10]);
});
test("fiyat aksiyonu batch ve magazadaki fiyat birlikte dogrulaninca tamamlanir", async () => {
  const sync = new SyncService({
    db: {},
    audit: {},
    trendyol: {
      getBatchResult: async () => ({
        items: [
          {
            requestItem: { barcode: "8690609598109" },
            status: "SUCCESS",
            failureReasons: [],
          },
        ],
      }),
      getProductByBarcode: async () => ({
        barcode: "8690609598109",
        salePrice: 312.28,
      }),
    },
  });
  const result = await sync.verifyPriceAction({
    barcode: "8690609598109",
    batch_id: "batch-1",
    proposed_price: 312.28,
  });
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.observedPrice, 312.28);
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
  assert.deepEqual(operations, ["update", "clear:Urunler!A3:AA3"]);
});
