const test = require("node:test");
const assert = require("node:assert/strict");
const { TrendyolService } = require("../../src/services/trendyol.service");
const { SyncService } = require("../../src/services/sync.service");

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
                    price: {
                      salePrice: 312.28,
                      listPrice: 320,
                      priceSeenByCustomer: 312.28,
                    },
                    stock: { quantity: 4 },
                    commission: 17,
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
  assert.equal(product.commission, 17);
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
            commission: 17,
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
            commission: 17,
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
            commission: 17,
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
  assert.equal(upserts[0].params[12], 17);
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
