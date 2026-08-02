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
                    images: [{ url: "/ty1/product/media/menekse.jpg" }],
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
  assert.equal(
    product.productImageUrl,
    "https://cdn.dsmcdn.com/ty1/product/media/menekse.jpg",
  );
  assert.match(requestedUrl, /barcode=8690609598109/);
  assert.match(requestedUrl, /products\/approved/);
});

test("Trendyol kargo faturasi servisleri dogru finans endpointlerini kullanir", async () => {
  const requests = [];
  const service = new TrendyolService({
    baseUrl: "https://trendyol.test/integration",
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: true,
        text: async () => JSON.stringify({ content: [], last: true }),
      };
    },
  });

  await service.listOtherFinancials({
    startDate: 1,
    endDate: 2,
    transactionType: "DeductionInvoices",
  });
  await service.listCargoInvoiceItems("KARGO/2026 07");

  assert.match(requests[0], /otherfinancials\?/);
  assert.match(requests[0], /transactionType=DeductionInvoices/);
  assert.match(
    requests[1],
    /cargo-invoice\/KARGO%2F2026%2007\/items\?page=0&size=500/,
  );
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
            productImageUrl: "https://cdn.test/active.jpg",
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
  assert.equal(upserts[0].params[5], "https://cdn.test/active.jpg");
  assert.equal(upserts[0].params[13], 17);
  assert.equal(upserts[0].params[14], true);
  assert.equal(upserts[1].params[14], false);
  assert.equal(upserts[2].params[14], false);
  const staleUpdate = queries.find((query) =>
    String(query.sql).includes("NOT (barcode=ANY"),
  );
  assert.deepEqual(staleUpdate.params[0], [
    "ACTIVE",
    "NO_STOCK",
    "NOT_ON_SALE",
  ]);
});

test("Hepsiburada listing sync urunleri ayri marketplace olarak yazar", async () => {
  const queries = [];
  const sync = new SyncService({
    audit: {},
    trendyol: {},
    hepsiburada: {
      configured: () => true,
      fetchAllListings: async () => [
        {
          merchantSku: "HB-SKU-1",
          productName: "Hepsiburada Ürünü",
          brand: "Marka",
          categoryName: "Kategori",
          categoryId: 123,
          price: 199.9,
          listPrice: 219.9,
          availableStock: 4,
          status: "ACTIVE",
          commissionRate: 15,
          buyboxPrice: 205,
          buyboxOrder: 2,
        },
      ],
    },
    db: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    },
  });

  const result = await sync.hepsiburadaProducts();
  assert.equal(result.processed, 1);
  const upsert = queries.find((query) =>
    String(query.sql).includes("INSERT INTO products"),
  );
  assert.match(upsert.sql, /'HEPSIBURADA'/);
  assert.equal(upsert.params[0], "HB-SKU-1");
  assert.equal(upsert.params[7], 199.9);
  assert.equal(upsert.params[13], 15);
  assert.equal(upsert.params[14], 205);
  assert.equal(upsert.params[17], 2);
  assert.equal(upsert.params[19], true);
});

test("Hepsiburada listing sync resmi komisyon servisi sonucunu urune yazar", async () => {
  const queries = [];
  const sync = new SyncService({
    audit: {},
    trendyol: {},
    hepsiburada: {
      configured: () => true,
      fetchAllListings: async () => [
        {
          merchantSku: "HB-SKU-COMMISSION",
          hbSku: "HBV-COMMISSION",
          productName: "Komisyonlu Ürün",
          price: 250,
          availableStock: 3,
          isSalable: true,
        },
      ],
      fetchCommissions: async (skus) => {
        assert.ok(skus.includes("HB-SKU-COMMISSION"));
        return [{ merchantSku: "HB-SKU-COMMISSION", commissionRate: 18.5 }];
      },
    },
    db: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (
          String(sql).includes("FROM products") &&
          String(sql).includes("marketplace='TRENDYOL'")
        )
          return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    },
  });

  const result = await sync.hepsiburadaProducts();
  const upsert = queries.find((query) =>
    String(query.sql).includes("INSERT INTO products"),
  );
  assert.equal(upsert.params[13], 18.5);
  assert.equal(result.metadata.hepsiburadaCommissionCount, 1);
  assert.equal(result.metadata.hepsiburadaCommissionError, null);
});

test("Hepsiburada listing sync alternatif komisyon SKU alanlarini eslestirir", async () => {
  const queries = [];
  const sync = new SyncService({
    audit: {},
    trendyol: {},
    hepsiburada: {
      configured: () => true,
      fetchAllListings: async () => [
        {
          merchantSku: "HB-MERCHANT-ALT",
          hbSku: "HBV-ALT",
          price: 250,
          availableStock: 3,
          isSalable: true,
        },
      ],
      fetchCommissions: async () => [
        { merchantStockCode: "HB-MERCHANT-ALT", commissionPercentage: 16.5 },
      ],
    },
    db: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    },
  });

  const result = await sync.hepsiburadaProducts();
  const upsert = queries.find((query) =>
    String(query.sql).includes("INSERT INTO products"),
  );
  assert.equal(upsert.params[13], 16.5);
  assert.equal(result.metadata.hepsiburadaCommissionMatched, 1);
  assert.equal(result.metadata.hepsiburadaCommissionMissing, 0);
});

test("Hepsiburada listing sync eksik katalog alanlarini Trendyol barkodundan tamamlar", async () => {
  const queries = [];
  const sync = new SyncService({
    audit: {},
    trendyol: {},
    hepsiburada: {
      configured: () => true,
      fetchAllListings: async () => [
        {
          merchantSku: "8690609598109",
          hbSku: "HBV-CATALOG-1",
          price: 312.28,
          availableStock: 5,
          status: "ACTIVE",
        },
      ],
    },
    db: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (
          String(sql).includes("FROM products") &&
          String(sql).includes("marketplace='TRENDYOL'")
        )
          return {
            rows: [
              {
                barcode: "8690609598109",
                product_name: "Menekşe Konsantre Yumuşatıcı 1500 ml",
                brand: "Actisoft",
                category_name: "Çamaşır Yumuşatıcısı",
                category_id: "12345",
                product_image_url: "https://cdn.test/menekse.jpg",
              },
            ],
            rowCount: 1,
          };
        return { rows: [], rowCount: 0 };
      },
    },
  });

  const result = await sync.hepsiburadaProducts();
  assert.equal(result.processed, 1);
  const upsert = queries.find((query) =>
    String(query.sql).includes("INSERT INTO products"),
  );
  assert.equal(upsert.params[1], "Menekşe Konsantre Yumuşatıcı 1500 ml");
  assert.equal(upsert.params[2], "Actisoft");
  assert.equal(upsert.params[3], "Çamaşır Yumuşatıcısı");
  assert.equal(upsert.params[4], "12345");
  assert.equal(upsert.params[5], "https://cdn.test/menekse.jpg");
});

test("Hepsiburada listing sync katalog alanlarini merchantSku ve hbSku ile tamamlar", async () => {
  const queries = [];
  const sync = new SyncService({
    audit: {},
    trendyol: {},
    hepsiburada: {
      configured: () => true,
      fetchAllListings: async () => [
        {
          merchantSku: "HB-MERCHANT-SKU-1",
          hbSku: "HBV-CATALOG-1",
          price: 499,
          availableStock: 4,
          isSalable: true,
        },
        {
          merchantSku: "HB-MERCHANT-SKU-2",
          hbSku: "HBV-CATALOG-2",
          price: 199,
          availableStock: 0,
          isSalable: false,
        },
      ],
      fetchAllMerchantProducts: async () => [
        {
          merchantSku: "HB-MERCHANT-SKU-1",
          hbSku: "HBV-CATALOG-1",
          productName: "Hepsiburada Katalog Ürünü",
          brand: "Harras",
          categoryName: "Çay",
          categoryId: 987,
          images: ["https://cdn.test/hb.jpg"],
        },
      ],
    },
    db: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (
          String(sql).includes("FROM products") &&
          String(sql).includes("marketplace='TRENDYOL'")
        )
          return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    },
  });

  const result = await sync.hepsiburadaProducts();
  assert.equal(result.processed, 2);
  assert.equal(result.metadata.hepsiburadaCatalogProducts, 1);
  const upserts = queries.filter((query) =>
    String(query.sql).includes("INSERT INTO products"),
  );
  assert.equal(upserts.length, 2);
  assert.equal(upserts[0].params[1], "Hepsiburada Katalog Ürünü");
  assert.equal(upserts[0].params[2], "Harras");
  assert.equal(upserts[0].params[3], "Çay");
  assert.equal(upserts[0].params[4], "987");
  assert.equal(upserts[1].params[0], "HB-MERCHANT-SKU-2");
  assert.equal(upserts[1].params[1], "");
  assert.equal(upserts[1].params[7], 199);
  assert.equal(upserts[0].params[5], "https://cdn.test/hb.jpg");
  assert.equal(upserts[0].params[6], "HBV-CATALOG-1");
  assert.equal(upserts[0].params[19], true);
});

test("Hepsiburada listing sync katalog gorsel objelerini URL olarak normalize eder", async () => {
  const queries = [];
  const sync = new SyncService({
    audit: {},
    trendyol: {},
    hepsiburada: {
      configured: () => true,
      fetchAllListings: async () => [
        {
          merchantSku: "HB-MERCHANT-SKU-IMAGE",
          hbSku: "HBV-IMAGE",
          price: 99,
          availableStock: 2,
          isSalable: true,
        },
      ],
      fetchAllMerchantProducts: async () => [
        {
          merchantSku: "HB-MERCHANT-SKU-IMAGE",
          hbSku: "HBV-IMAGE",
          productName: "Görselli Ürün",
          brand: "Marka",
          categoryName: "Kategori",
          categoryId: 111,
          images: [
            { url: "https://productimages.hepsiburada.net/s/1/{size}/x.jpg" },
          ],
        },
      ],
    },
    db: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (
          String(sql).includes("FROM products") &&
          String(sql).includes("marketplace='TRENDYOL'")
        )
          return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    },
  });

  await sync.hepsiburadaProducts();

  const upsert = queries.find((query) =>
    String(query.sql).includes("INSERT INTO products"),
  );
  assert.equal(
    upsert.params[5],
    "https://productimages.hepsiburada.net/s/1/500/x.jpg",
  );
});

test("Hepsiburada sync katalogu ana urun kaynagi yapar ve listing fiyat stokla zenginlestirir", async () => {
  const queries = [];
  const sync = new SyncService({
    audit: {},
    trendyol: {},
    hepsiburada: {
      configured: () => true,
      fetchAllListings: async () => [
        {
          merchantSku: "SELLER-SKU-1",
          hepsiburadaSku: "HBV-1",
          productId: "HB-PRODUCT-1",
          price: 100,
          availableStock: 3,
          isSalable: true,
        },
        {
          merchantSku: "SELLER-SKU-2",
          hepsiburadaSku: "HBV-2",
          price: 200,
          availableStock: 0,
          isSalable: false,
        },
        {
          merchantSku: "LISTING-ONLY-OLD",
          hepsiburadaSku: "HBV-OLD",
          price: 999,
          availableStock: 9,
          isSalable: true,
        },
      ],
      fetchAllMerchantProducts: async () => [
        {
          merchantSku: "CATALOG-SKU-1",
          hbSku: "HBV-1",
          productId: "HB-PRODUCT-1",
          productName: "Katalog Ürünü 1",
          brand: "Marka 1",
          categoryName: "Kategori 1",
          categoryId: 101,
          images: ["https://cdn.test/one.jpg"],
        },
        {
          merchantSku: "SELLER-SKU-2",
          hbSku: "HBV-2",
          productName: "Katalog Ürünü 2",
          brand: "Marka 2",
          categoryName: "Kategori 2",
          categoryId: 102,
          images: ["https://cdn.test/two.jpg"],
        },
      ],
    },
    db: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (
          String(sql).includes("FROM products") &&
          String(sql).includes("marketplace='TRENDYOL'")
        )
          return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    },
  });

  const result = await sync.hepsiburadaProducts();
  assert.equal(result.processed, 3);
  assert.equal(result.metadata.hepsiburadaCatalogProducts, 2);
  const upserts = queries.filter((query) =>
    String(query.sql).includes("INSERT INTO products"),
  );
  assert.equal(upserts.length, 3);
  assert.equal(upserts[0].params[0], "SELLER-SKU-1");
  assert.equal(upserts[0].params[1], "Katalog Ürünü 1");
  assert.equal(upserts[0].params[2], "Marka 1");
  assert.equal(upserts[0].params[5], "https://cdn.test/one.jpg");
  assert.equal(upserts[0].params[6], "HBV-1");
  assert.equal(upserts[0].params[7], 100);
  assert.equal(upserts[0].params[9], 3);
  assert.equal(upserts[0].params[19], true);
  assert.equal(upserts[1].params[0], "SELLER-SKU-2");
  assert.equal(upserts[1].params[1], "Katalog Ürünü 2");
  assert.equal(upserts[1].params[19], false);
  assert.equal(upserts[2].params[0], "LISTING-ONLY-OLD");
  assert.equal(upserts[2].params[1], "");
  assert.equal(upserts[2].params[7], 999);
  const staleUpdate = queries.find(
    (query) =>
      String(query.sql).includes("marketplace='HEPSIBURADA'") &&
      String(query.sql).includes("NOT (barcode=ANY"),
  );
  assert.deepEqual(staleUpdate.params[0], [
    "SELLER-SKU-1",
    "SELLER-SKU-2",
    "LISTING-ONLY-OLD",
  ]);
});

test("Hepsiburada listing sync bulk katalog bos ise tekil metadata sorgular", async () => {
  const queries = [];
  const sync = new SyncService({
    audit: {},
    trendyol: {},
    hepsiburada: {
      configured: () => true,
      fetchAllListings: async () => [
        {
          merchantSku: "HB-MERCHANT-SKU-1",
          hbSku: "HBV-CATALOG-1",
          price: 499,
          availableStock: 4,
          isSalable: true,
        },
      ],
      fetchAllMerchantProducts: async () => [],
      getMerchantProductMetadata: async ({ merchantSku, hbSku }) => ({
        merchantSku,
        hbSku,
        productName: "Tekil Katalog Ürünü",
        brand: "Ülker",
        categoryName: "Kakao",
        categoryId: 654,
        images: ["https://cdn.test/single.jpg"],
      }),
    },
    db: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (
          String(sql).includes("FROM products") &&
          String(sql).includes("marketplace='TRENDYOL'")
        )
          return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    },
  });

  const result = await sync.hepsiburadaProducts();
  assert.equal(result.metadata.hepsiburadaCatalogProducts, 1);
  assert.equal(result.metadata.hepsiburadaCatalogLookupCount, 1);
  const upsert = queries.find((query) =>
    String(query.sql).includes("INSERT INTO products"),
  );
  assert.equal(upsert.params[1], "Tekil Katalog Ürünü");
  assert.equal(upsert.params[2], "Ülker");
  assert.equal(upsert.params[3], "Kakao");
  assert.equal(upsert.params[4], "654");
  assert.equal(upsert.params[5], "https://cdn.test/single.jpg");
});

test("Hepsiburada listing sync bos katalog alanlariyla mevcut urun bilgisini ezmez", async () => {
  const queries = [];
  const sync = new SyncService({
    audit: {},
    trendyol: {},
    hepsiburada: {
      configured: () => true,
      fetchAllListings: async () => [
        {
          merchantSku: "HB-MERCHANT-SKU-1",
          hbSku: "HBV-CATALOG-1",
          price: 499,
          availableStock: 4,
          isSalable: true,
        },
      ],
      fetchAllMerchantProducts: async () => [],
    },
    db: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (
          String(sql).includes("FROM products") &&
          String(sql).includes("marketplace='TRENDYOL'")
        )
          return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    },
  });

  await sync.hepsiburadaProducts();
  const upsert = queries.find((query) =>
    String(query.sql).includes("INSERT INTO products"),
  );
  assert.match(
    upsert.sql,
    /product_name=COALESCE\(NULLIF\(EXCLUDED\.product_name,''\),products\.product_name\)/,
  );
  assert.match(
    upsert.sql,
    /product_image_url=COALESCE\(NULLIF\(EXCLUDED\.product_image_url,''\),products\.product_image_url\)/,
  );
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
