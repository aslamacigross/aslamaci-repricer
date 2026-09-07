const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalHepsiburadaCarrier,
  moneyValue,
  timestamp,
} = require("../../src/services/finance.service");
const { env } = require("../../src/config/env");
const {
  DEFAULT_ENDPOINTS,
  HepsiburadaService,
  listingDeactivationSummary,
  normalizeBuyboxOrders,
  normalizedEnvironment,
  normalizeRows,
  normalizeCommissionRows,
  orderLineItemRequestsFromPayload,
  packageNumberFromPayload,
} = require("../../src/services/hepsiburada.service");

describe("Hepsiburada order value normalization", () => {
  test("supports numeric and money object values", () => {
    assert.equal(moneyValue(249.9), 249.9);
    assert.equal(moneyValue({ amount: 249.9, currency: "TRY" }), 249.9);
    assert.equal(moneyValue({ value: "249.90" }), 249.9);
    assert.equal(moneyValue(null, 7), 7);
  });

  test("supports ISO and epoch timestamps without throwing", () => {
    assert.ok(timestamp("2026-07-20T10:00:00.000Z") instanceof Date);
    assert.ok(timestamp(1784541600000) instanceof Date);
    assert.equal(timestamp("not-a-date"), null);
  });

  test("normalizes carrier names to the imported tariff", () => {
    assert.equal(canonicalHepsiburadaCarrier("HepsiJet Standart"), "hepsiJET");
    assert.equal(canonicalHepsiburadaCarrier("HepsiJet XL"), "hepsiJET XL");
    assert.equal(canonicalHepsiburadaCarrier("Yurtiçi"), "Yurtiçi Kargo");
    assert.equal(canonicalHepsiburadaCarrier("Aras Kargo A.Ş."), "Aras Kargo");
  });
});

describe("Hepsiburada API runtime configuration", () => {
  test("normalizes SIT and production environment names", () => {
    assert.equal(normalizedEnvironment("test"), "sit");
    assert.equal(normalizedEnvironment("sit"), "sit");
    assert.equal(normalizedEnvironment("production"), "production");
    assert.equal(normalizedEnvironment("prod"), "production");
  });

  test("uses SIT endpoints and developer User-Agent without exposing secrets", () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaUsername: env.hepsiburadaUsername,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaIntegratorKey: env.hepsiburadaIntegratorKey,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
      hepsiburadaOrderBaseUrl: env.hepsiburadaOrderBaseUrl,
      hepsiburadaListingBaseUrl: env.hepsiburadaListingBaseUrl,
      hepsiburadaProductBaseUrl: env.hepsiburadaProductBaseUrl,
      hepsiburadaMutationsEnabled: env.hepsiburadaMutationsEnabled,
      hepsiburadaPriceUpdatesEnabled: env.hepsiburadaPriceUpdatesEnabled,
    };
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaUsername: "",
      hepsiburadaPassword: "secret-key",
      hepsiburadaIntegratorKey: "",
      hepsiburadaUserAgent: "aslamacigross_dev",
      hepsiburadaOrderBaseUrl: "",
      hepsiburadaListingBaseUrl: "",
      hepsiburadaProductBaseUrl: "",
      hepsiburadaMutationsEnabled: false,
      hepsiburadaPriceUpdatesEnabled: false,
    });
    try {
      const service = new HepsiburadaService({ environment: "sit" });
      assert.equal(service.orderBaseUrl, DEFAULT_ENDPOINTS.sit.orderBaseUrl);
      assert.equal(service.headers()["User-Agent"], "aslamacigross_dev");
      const status = service.runtimeStatus();
      assert.equal(status.environment, "sit");
      assert.equal(status.configured, true);
      assert.equal(status.mutationsEnabled, false);
      assert.equal(status.priceUpdatesEnabled, false);
      assert.equal(JSON.stringify(status).includes("secret-key"), false);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("Railway HEPSIBURADA_* secret aliaslari runtime env'e okunur", () => {
    assert.equal(normalizeRows({ items: [{ id: 1 }] }).length, 1);
    assert.equal(normalizeRows({ listings: [{ id: 1 }, { id: 2 }] }).length, 2);
    assert.equal(normalizeRows({ data: { content: [{ id: 3 }] } })[0].id, 3);
    assert.deepEqual(
      listingDeactivationSummary([
        { isSalable: true },
        { deactivationReasons: ["StockIsLessThanOrEqualToZero"] },
        {
          deactivationReasons: [
            "PriceIsLessThanOrEqualToZero",
            "StockIsLessThanOrEqualToZero",
          ],
        },
      ]),
      {
        SALABLE: 1,
        StockIsLessThanOrEqualToZero: 2,
        PriceIsLessThanOrEqualToZero: 1,
      },
    );
  });

  test("listing okuma endpointi Basic auth ve User-Agent ile cagrilir", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaUsername: env.hepsiburadaUsername,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    let request;
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaUsername: "",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "sit",
        fetch: async (url, options) => {
          request = { url, options };
          return {
            ok: true,
            text: async () =>
              JSON.stringify({ listings: [{ merchantSku: "SKU1" }] }),
          };
        },
      });
      const rows = await service.fetchAllListings({
        pageSize: 100,
        maxPages: 1,
      });
      assert.equal(rows.length, 1);
      assert.match(request.url, /listings\/merchantid\/merchant-id/);
      assert.equal(request.options.headers["User-Agent"], "aslamacigross_dev");
      assert.match(request.options.headers.Authorization, /^Basic /);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("official buybox endpointi production URL Basic auth ve skuList kullanir", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaUsername: env.hepsiburadaUsername,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
      hepsiburadaListingBaseUrl: env.hepsiburadaListingBaseUrl,
    };
    let request;
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaUsername: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamaci_dev",
      hepsiburadaListingBaseUrl: "",
    });
    try {
      const service = new HepsiburadaService({
        environment: "production",
        fetch: async (url, options) => {
          request = { url, options };
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                variants: [
                  {
                    sku: "HBV1",
                    buyboxOrders: [
                      {
                        rank: 1,
                        merchantName: "AŞLAMACI GROSS",
                        price: 100,
                      },
                    ],
                  },
                ],
              }),
          };
        },
      });
      const payload = await service.getBuyboxOrders({ skuList: ["HBV1"] });
      assert.equal(payload.variants.length, 1);
      assert.match(
        request.url,
        /listing-external\.hepsiburada\.com\/buybox-orders\/merchantid\/merchant-id/,
      );
      assert.equal(new URL(request.url).searchParams.get("skuList"), "HBV1");
      assert.equal(request.options.headers["User-Agent"], "aslamaci_dev");
      assert.match(request.options.headers.Authorization, /^Basic /);
      assert.equal(JSON.stringify(request).includes("secret-key"), false);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("official buybox endpointi SIT URL ve 10lu skuList siniri kullanir", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
      hepsiburadaListingBaseUrl: env.hepsiburadaListingBaseUrl,
    };
    let request;
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamaci_dev",
      hepsiburadaListingBaseUrl: "",
    });
    try {
      const service = new HepsiburadaService({
        environment: "sit",
        fetch: async (url, options) => {
          request = { url, options };
          return {
            ok: true,
            text: async () => JSON.stringify({ variants: [] }),
          };
        },
      });
      await service.getBuyboxOrders({
        skuList: Array.from({ length: 12 }, (_, index) => `HBV${index + 1}`),
      });
      assert.match(
        request.url,
        /listing-external-sit\.hepsiburada\.com\/buybox-orders\/merchantid\/merchant-id/,
      );
      const skus = new URL(request.url).searchParams.get("skuList").split(",");
      assert.equal(skus.length, 10);
      assert.equal(skus[0], "HBV1");
      assert.equal(skus[9], "HBV10");
    } finally {
      Object.assign(env, previous);
    }
  });

  test("official buybox response yaygin alanlari normalize edilir", () => {
    const rows = normalizeBuyboxOrders({
      variants: [
        {
          hbSku: "HBV1",
          buyboxOrders: [
            { position: 2, seller: "Rakip", winningPrice: 110 },
            {
              rank: 1,
              merchantName: "AŞLAMACI GROSS",
              price: 100,
              originalPrice: 120,
            },
          ],
        },
        { sku: "HBV2", buyboxOrders: [] },
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sku, "HBV1");
    assert.equal(rows[0].buyboxOrders[0].rank, 1);
    assert.equal(rows[0].buyboxOrders[0].price, 100);
    assert.equal(rows[0].buyboxOrders[1].rank, 2);
    assert.equal(rows[0].buyboxOrders[1].merchantName, "Rakip");
    assert.deepEqual(rows[1].buyboxOrders, []);
  });

  test("public buybox 429 cevabinda sinirli retry yapar", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    let calls = 0;
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-1",
      hepsiburadaUserAgent: "aslamaci_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "production",
        fetch: async () => {
          calls++;
          if (calls === 1)
            return {
              ok: false,
              status: 429,
              url: "https://www.hepsiburada.com/ara?q=HBV1",
              text: async () => "rate limited",
            };
          return {
            ok: true,
            status: 200,
            url: "https://www.hepsiburada.com/ara?q=HBV1",
            text: async () =>
              `<script type="mime/invalid" id="reduxStore">${JSON.stringify({
                productState: {
                  product: {
                    sku: "HBV1",
                    merchantName: "AŞLAMACI GROSS",
                    merchantId: "merchant-1",
                    prices: [{ value: 100 }],
                  },
                },
              })}</script>`,
          };
        },
      });
      const result = await service.fetchPublicBuybox({
        hbSku: "HBV1",
        diagnostics: true,
      });
      assert.equal(calls, 2);
      assert.equal(result.ok, true);
      assert.equal(result.rank, 1);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("komisyon servisi SKUlari resmi 50li paketlerle sorgular", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaUsername: env.hepsiburadaUsername,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    const requests = [];
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaUsername: "",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamaci_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "production",
        fetch: async (url) => {
          requests.push(url);
          const skus = new URL(url).searchParams.get("skuList").split(",");
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                commissions: skus.map((sku) => ({
                  merchantSku: sku,
                  commissionRate: 17,
                })),
              }),
          };
        },
      });
      const rows = await service.fetchCommissions(
        Array.from({ length: 51 }, (_, index) => `SKU-${index + 1}`),
      );
      assert.equal(requests.length, 2);
      assert.match(
        requests[0],
        /listing-external\.hepsiburada\.com\/commissions\/merchantid\/merchant-id/,
      );
      assert.equal(
        new URL(requests[0]).searchParams.get("skuList").split(",").length,
        50,
      );
      assert.equal(rows.length, 51);
      assert.equal(rows[0].commissionRate, 17);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("komisyon cevabinin yaygin zarflarini normalize eder", () => {
    assert.equal(
      normalizeCommissionRows({ data: { items: [{ sku: "A", rate: 12 }] } })[0]
        .rate,
      12,
    );
    assert.deepEqual(normalizeCommissionRows({ B: 15 }), [
      { sku: "B", commissionRate: 15 },
    ]);
    assert.deepEqual(
      normalizeCommissionRows({
        data: {
          "HBV-1": { commissionPercentage: 17.5 },
          "MERCHANT-2": { commissionRate: 12 },
          "MERCHANT-3": { commission: { rate: 14 } },
        },
      }).map((row) => [
        row.sku,
        row.commissionPercentage ?? row.commissionRate ?? row.commission?.rate,
      ]),
      [
        ["HBV-1", 17.5],
        ["MERCHANT-2", 12],
        ["MERCHANT-3", 14],
      ],
    );
  });

  test("magaza bazli katalog urunlerini resmi product endpointinden okur", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaUsername: env.hepsiburadaUsername,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    let request;
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaUsername: "",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamaci_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "production",
        fetch: async (url, options) => {
          request = { url, options };
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                data: [
                  {
                    merchantSku: "HB-MERCHANT-SKU",
                    hbSku: "HBV1",
                    productName: "Hepsiburada Katalog Ürünü",
                  },
                ],
                last: true,
              }),
          };
        },
      });
      const rows = await service.fetchAllMerchantProducts({
        pageSize: 1000,
        maxPages: 1,
      });
      assert.equal(rows.length, 1);
      assert.match(
        request.url,
        /mpop\.hepsiburada\.com\/product\/api\/products\/all-products-of-merchant\/merchant-id/,
      );
      assert.match(request.url, /page=0/);
      assert.match(request.url, /size=1000/);
      assert.equal(request.options.headers["User-Agent"], "aslamaci_dev");
    } finally {
      Object.assign(env, previous);
    }
  });

  test("katalog endpointi size degerini sinirlasa bile sayfalari okumaya devam eder", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaUsername: env.hepsiburadaUsername,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    const requestedPages = [];
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaUsername: "",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamaci_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "production",
        fetch: async (url) => {
          const parsed = new URL(url);
          const page = Number(parsed.searchParams.get("page"));
          requestedPages.push(page);
          const rows =
            page < 2
              ? Array.from({ length: 10 }, (_, index) => ({
                  merchantSku: `SKU-${page}-${index}`,
                  hbSku: `HBV-${page}-${index}`,
                  productName: `Urun ${page}-${index}`,
                }))
              : [
                  {
                    merchantSku: "SKU-2-0",
                    hbSku: "HBV-2-0",
                    productName: "Son urun",
                  },
                ];
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                data: { content: rows, number: page, totalPages: 3 },
                last: page === 2,
              }),
          };
        },
      });
      const rows = await service.fetchAllMerchantProducts({
        pageSize: 1000,
        maxPages: 10,
      });
      assert.equal(rows.length, 21);
      assert.deepEqual(requestedPages, [0, 1, 2]);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("canli katalog teshisi listing ve katalog kaynaklarini secret siz ozetler", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaUsername: env.hepsiburadaUsername,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    const requests = [];
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaUsername: "",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamaci_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "production",
        fetch: async (url, options = {}) => {
          requests.push({ url, options });
          if (String(url).includes("listing-external.hepsiburada.com")) {
            return {
              ok: true,
              text: async () =>
                JSON.stringify({
                  listings: [
                    {
                      merchantSku: "MERCHANT-SKU-1",
                      hepsiburadaSku: "HBV1",
                      price: 100,
                      availableStock: 10,
                      isSalable: true,
                    },
                  ],
                }),
            };
          }
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                data: {
                  content: [
                    {
                      merchantSku: "MERCHANT-SKU-1",
                      hbSku: "HBV1",
                      productName: "Hepsiburada Katalog Detayli Urun",
                      brand: "Marka",
                      categoryId: 123,
                      categoryName: "Kategori",
                      images: ["https://example.test/image.jpg"],
                    },
                  ],
                },
              }),
          };
        },
      });
      const result = await service.catalogDiagnostics({
        merchantSku: "MERCHANT-SKU-1",
        hbSku: "HBV1",
      });
      assert.equal(result.environment, "production");
      assert.equal(result.input.merchantSku, "provided");
      assert.equal(result.listing.count, 1);
      assert.equal(result.catalogFiltered.count, 1);
      assert.equal(
        result.catalogFiltered.first.productName,
        "Hepsiburada Katalog Detayli Urun",
      );
      assert.equal(result.catalogFiltered.first.imagesCount, 1);
      assert.equal(result.errors.length, 0);
      assert.equal(JSON.stringify(result).includes("secret-key"), false);
      assert.ok(
        requests.some((request) =>
          String(request.url).includes("merchantSku=MERCHANT-SKU-1"),
        ),
      );
    } finally {
      Object.assign(env, previous);
    }
  });

  test("production 401 hatasi SIT ortam ipucunu secret siz verir", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaUsername: env.hepsiburadaUsername,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaUsername: "",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "production",
        fetch: async () => ({
          ok: false,
          status: 401,
          text: async () =>
            "Merchant api authorization failed. userName: merchant-id",
        }),
      });
      await assert.rejects(
        () => service.listListings({ offset: 0, limit: 1 }),
        (error) => {
          assert.equal(error.status, 401);
          assert.match(error.message, /HEPSIBURADA_ENV=sit/);
          assert.equal(error.message.includes("secret-key"), false);
          return true;
        },
      );
    } finally {
      Object.assign(env, previous);
    }
  });

  test("SIT test merkezi production ortaminda dis istek hazirlamadan bloklar", () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
      hepsiburadaMutationsEnabled: env.hepsiburadaMutationsEnabled,
      hepsiburadaPriceUpdatesEnabled: env.hepsiburadaPriceUpdatesEnabled,
    };
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
      hepsiburadaMutationsEnabled: false,
      hepsiburadaPriceUpdatesEnabled: false,
    });
    try {
      const service = new HepsiburadaService({ environment: "production" });
      const center = service.sitTestCenter({
        publicBaseUrl: "https://preview.test",
      });
      assert.equal(center.safety.sitOnly, false);
      assert.ok(center.blockedReasons.includes("HEPSIBURADA_ENV_SIT_REQUIRED"));
      assert.equal(
        center.steps.find((step) => step.code === "catalog").status,
        "BLOCKED",
      );
      assert.equal(JSON.stringify(center).includes("secret-key"), false);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("SIT test onizlemesi secret siz dry-run payload uretir", () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
      hepsiburadaMutationsEnabled: env.hepsiburadaMutationsEnabled,
      hepsiburadaPriceUpdatesEnabled: env.hepsiburadaPriceUpdatesEnabled,
    };
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
      hepsiburadaMutationsEnabled: false,
      hepsiburadaPriceUpdatesEnabled: false,
    });
    try {
      const service = new HepsiburadaService({ environment: "sit" });
      const preview = service.sitTestPreview("catalog", {
        publicBaseUrl: "https://preview.test",
      });
      assert.equal(preview.sendsRequest, false);
      assert.equal(preview.preview.mode, "dry-run");
      assert.equal(
        preview.safety.publicWebhookUrl,
        "https://preview.test/api/public/hepsiburada/webhook",
      );
      assert.equal(JSON.stringify(preview).includes("secret-key"), false);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("SIT listing testi fiyat stok ve sonuc sorgularini SIT endpointlerine gonderir", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
      hepsiburadaListingBaseUrl: env.hepsiburadaListingBaseUrl,
    };
    const requests = [];
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
      hepsiburadaListingBaseUrl: "",
    });
    try {
      const service = new HepsiburadaService({
        environment: "sit",
        fetch: async (url, options = {}) => {
          requests.push({ url, options });
          if (String(url).includes("stock-uploads/id"))
            return {
              ok: true,
              text: async () => JSON.stringify({ status: "OK" }),
            };
          if (String(url).includes("price-uploads/id"))
            return {
              ok: true,
              text: async () => JSON.stringify({ status: "OK" }),
            };
          if (String(url).includes("stock-uploads"))
            return {
              ok: true,
              text: async () => JSON.stringify({ id: "stock-1" }),
            };
          if (String(url).includes("price-uploads"))
            return {
              ok: true,
              text: async () => JSON.stringify({ id: "price-1" }),
            };
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                listings: [{ merchantSku: "8660891646397", isSalable: true }],
              }),
          };
        },
      });
      const result = await service.sitTestRun("listing", {
        merchantSku: "8660891646397",
        hbSku: "HBV000010LWPR",
        price: 1000,
        stock: 20000,
      });
      assert.equal(result.ok, true);
      assert.ok(
        requests.every((request) =>
          String(request.url).includes("listing-external-sit.hepsiburada.com"),
        ),
      );
      assert.ok(
        requests.some((request) =>
          String(request.url).includes("stock-uploads"),
        ),
      );
      assert.ok(
        requests.some((request) =>
          String(request.url).includes("price-uploads"),
        ),
      );
      assert.ok(
        result.checklist.some(
          (item) =>
            item.title === "Listing activate / satilabilirlik dogrulama" &&
            item.ok === true,
        ),
      );
      assert.equal(
        requests.some((request) => String(request.url).includes("activate")),
        false,
      );
      assert.equal(JSON.stringify(result).includes("secret-key"), false);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("SIT katalog testi productName gonderir ve tracking sonucu sorgular", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    const requests = [];
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "sit",
        fetch: async (url, options = {}) => {
          requests.push({ url, options });
          if (String(url).includes("/status/trace-1"))
            return {
              ok: true,
              text: async () => JSON.stringify({ status: "Done" }),
            };
          return {
            ok: true,
            text: async () => JSON.stringify({ trackingId: "trace-1" }),
          };
        },
      });
      const result = await service.sitTestRun("catalog", {
        merchantSku: "SKU1",
        productName: "Aşlamacı ERP SIT Test Ürünü",
      });
      const upload = requests.find((request) =>
        String(request.url).includes("/products/fastlisting"),
      );
      const body = JSON.parse(upload.options.body);
      assert.equal(body[0].productName, "Aşlamacı ERP SIT Test Ürünü");
      assert.equal(result.ok, true);
      assert.ok(
        requests.some((request) =>
          String(request.url).includes("/status/trace-1"),
        ),
      );
    } finally {
      Object.assign(env, previous);
    }
  });

  test("SIT toplu satis acma testi tum listinglere fiyat stok gonderir", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    const requests = [];
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "sit",
        fetch: async (url, options = {}) => {
          requests.push({ url, options });
          if (String(url).includes("stock-uploads/id"))
            return {
              ok: true,
              text: async () => JSON.stringify({ status: "Done" }),
            };
          if (String(url).includes("price-uploads/id"))
            return {
              ok: true,
              text: async () => JSON.stringify({ status: "Done" }),
            };
          if (String(url).includes("stock-uploads"))
            return {
              ok: true,
              text: async () => JSON.stringify({ id: "stock-bulk" }),
            };
          if (String(url).includes("price-uploads"))
            return {
              ok: true,
              text: async () => JSON.stringify({ id: "price-bulk" }),
            };
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                listings: [
                  {
                    merchantSku: "SKU1",
                    hepsiburadaSku: "HBV1",
                    price: 10,
                    availableStock: 0,
                    isSalable: true,
                  },
                  {
                    merchantSku: "SKU2",
                    hepsiburadaSku: "HBV2",
                    price: 20,
                    availableStock: 0,
                    isSalable: true,
                  },
                ],
              }),
          };
        },
      });
      const result = await service.sitTestRun("bulk-listing", {
        price: 1000,
        stock: 20000,
      });
      const stockUpload = requests.find(
        (request) =>
          String(request.url).includes("stock-uploads") &&
          !String(request.url).includes("/id/"),
      );
      const priceUpload = requests.find(
        (request) =>
          String(request.url).includes("price-uploads") &&
          !String(request.url).includes("/id/"),
      );
      assert.equal(JSON.parse(stockUpload.options.body).length, 2);
      assert.equal(JSON.parse(priceUpload.options.body).length, 2);
      assert.deepEqual(JSON.parse(stockUpload.options.body)[0], {
        merchantSku: "SKU1",
        hepsiburadaSku: "HBV1",
        availableStock: 20000,
      });
      assert.deepEqual(JSON.parse(priceUpload.options.body)[0], {
        merchantSku: "SKU1",
        hepsiburadaSku: "HBV1",
        price: 1000,
      });
      assert.equal(result.ok, true);
      assert.ok(
        result.checklist.some(
          (item) =>
            item.title === "Satis acik urun sayisi" &&
            item.ok === true &&
            item.message === "2/2 listing isSalable=true",
        ),
      );
      assert.ok(
        result.checklist.some(
          (item) =>
            item.title === "Satis kapali neden ozeti" &&
            item.ok === true &&
            item.message === '{"SALABLE":2}',
        ),
      );
      assert.equal(JSON.stringify(result).includes("secret-key"), false);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("SIT siparis testi numerik OrderNumber uretir", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    const requests = [];
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
    });
    try {
      let createdOrderNumber = null;
      const service = new HepsiburadaService({
        environment: "sit",
        fetch: async (url, options = {}) => {
          requests.push({ url, options });
          if (String(url).includes("oms-stub-external-sit")) {
            createdOrderNumber = JSON.parse(options.body).OrderNumber;
            return {
              ok: true,
              text: async () => JSON.stringify({ order: "ok" }),
            };
          }
          if (
            String(url).includes("/orders/merchantid/merchant-id") &&
            !String(url).includes("oms-stub-external-sit")
          )
            return {
              ok: true,
              text: async () =>
                JSON.stringify({
                  items: [
                    {
                      orderNumber: createdOrderNumber,
                      lineItems: [{ lineItemId: "LINE-1", quantity: 1 }],
                    },
                  ],
                }),
            };
          if (
            String(url).endsWith("/packages/merchantid/merchant-id") &&
            options.method === "POST"
          )
            return {
              ok: true,
              text: async () => JSON.stringify({ packageNumber: "PKG-1" }),
            };
          if (String(url).includes("/packages/merchantid"))
            return {
              ok: true,
              text: async () =>
                JSON.stringify({ packages: [{ packageNumber: "PKG-1" }] }),
            };
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                listings: [
                  {
                    listingId: "listing-1",
                    merchantSku: "SKU1",
                    hepsiburadaSku: "HBV1",
                    price: 100,
                  },
                ],
              }),
          };
        },
      });
      const result = await service.sitTestRun("order", {
        merchantSku: "SKU1",
        packagePollAttempts: 1,
      });
      const orderRequest = requests.find((request) =>
        String(request.url).includes("oms-stub-external-sit"),
      );
      const body = JSON.parse(orderRequest.options.body);
      assert.match(body.OrderNumber, /^\d+$/);
      assert.equal(body.LineItems[0].Quantity, 1);
      assert.equal(body.LineItems[0].CargoCompanyId, 89100);
      const packageCreateRequest = requests.find(
        (request) =>
          String(request.url).endsWith("/packages/merchantid/merchant-id") &&
          request.options.method === "POST",
      );
      const packageBody = JSON.parse(packageCreateRequest.options.body);
      assert.deepEqual(packageBody.lineItemRequests, [
        { id: "LINE-1", quantity: "1" },
      ]);
      assert.ok(
        requests.some((request) =>
          String(request.url).includes(
            "/packages/merchantid/merchant-id?limit=100&offset=0",
          ),
        ),
      );
      assert.equal(result.ok, true);
      assert.equal(result.responses[1].response.cargoCompanyId, 89100);
      assert.ok(
        result.checklist.some(
          (item) => item.title === "LineItemId ile paket olusturma" && item.ok,
        ),
      );
    } finally {
      Object.assign(env, previous);
    }
  });

  test("Hepsiburada order payloadindan lineItemId paketleme satirlari cikarilir", () => {
    const rows = orderLineItemRequestsFromPayload(
      {
        items: [
          {
            id: "ORDER-CONTAINER-ID",
            orderNumber: "ORDER-1",
            lineItems: [
              { lineItemId: "LINE-1", quantity: 2 },
              { lineItemId: "LINE-1", quantity: 2 },
            ],
          },
          {
            id: "HB-OPEN-ITEM-ID",
            orderNumber: "ORDER-1",
            canCreatePackage: true,
            quantity: 1,
          },
          {
            id: "NOT-PACKAGEABLE-ID",
            orderNumber: "ORDER-1",
            canCreatePackage: false,
            quantity: 1,
          },
          {
            orderNumber: "ORDER-2",
            lineItems: [{ lineItemId: "LINE-2", quantity: 1 }],
          },
        ],
      },
      "ORDER-1",
    );
    assert.deepEqual(rows, [
      { lineItemId: "LINE-1", quantity: 2 },
      { lineItemId: "HB-OPEN-ITEM-ID", quantity: 1 },
    ]);
  });

  test("SIT paket statu testi paket numarasini bulur ve SIT endpointlerini cagirir", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    const requests = [];
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "sit",
        fetch: async (url, options = {}) => {
          requests.push({ url, options });
          if (String(url).includes("?limit=100&offset=0"))
            return {
              ok: true,
              text: async () =>
                JSON.stringify({ packages: [{ packageNumber: "PKG-1" }] }),
            };
          return {
            ok: true,
            text: async () => JSON.stringify({ status: "OK" }),
          };
        },
      });
      const result = await service.sitTestRun("package-status", {
        packageAction: "deliver_flow",
      });
      assert.equal(result.ok, true);
      assert.equal(
        packageNumberFromPayload({ packages: [{ packageNumber: "PKG-1" }] }),
        "PKG-1",
      );
      assert.ok(
        requests.some((request) =>
          String(request.url).endsWith(
            "/packages/merchantid/merchant-id/packagenumber/PKG-1/intransit",
          ),
        ),
      );
      const inTransitRequest = requests.find((request) =>
        String(request.url).endsWith(
          "/packages/merchantid/merchant-id/packagenumber/PKG-1/intransit",
        ),
      );
      const inTransitBody = JSON.parse(inTransitRequest.options.body);
      assert.ok(inTransitBody.shippedDate);
      assert.ok(
        requests.some((request) =>
          String(request.url).endsWith(
            "/packages/merchantid/merchant-id/packagenumber/PKG-1/deliver",
          ),
        ),
      );
      const deliverRequest = requests.find((request) =>
        String(request.url).endsWith(
          "/packages/merchantid/merchant-id/packagenumber/PKG-1/deliver",
        ),
      );
      const deliverBody = JSON.parse(deliverRequest.options.body);
      assert.ok(deliverBody.receivedDate);
      assert.equal(deliverBody.receivedBy, "Aşlamacı ERP SIT Test");
      assert.equal(JSON.stringify(result).includes("secret-key"), false);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("SIT paket statu testi paket yoksa order line item ile paket olusturur", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    const requests = [];
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
    });
    try {
      let createdOrderNumber = null;
      const service = new HepsiburadaService({
        environment: "sit",
        fetch: async (url, options = {}) => {
          requests.push({ url, options });
          if (
            String(url).endsWith("/packages/merchantid/merchant-id") &&
            options.method === "POST"
          )
            return {
              ok: true,
              text: async () => JSON.stringify({ packageNumber: "PKG-2" }),
            };
          if (String(url).includes("/packages/merchantid"))
            return {
              ok: true,
              text: async () =>
                JSON.stringify({ packages: [{ packageNumber: "PKG-2" }] }),
            };
          if (String(url).includes("oms-stub-external-sit")) {
            createdOrderNumber = JSON.parse(options.body).OrderNumber;
            return {
              ok: true,
              text: async () => JSON.stringify({}),
            };
          }
          if (String(url).includes("/orders/merchantid/merchant-id"))
            return {
              ok: true,
              text: async () =>
                JSON.stringify({
                  items: [
                    {
                      orderNumber: createdOrderNumber,
                      lineItems: [{ lineItemId: "LINE-2", quantity: 1 }],
                    },
                  ],
                }),
            };
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                listings: [
                  {
                    listingId: "listing-1",
                    merchantSku: "SKU1",
                    hepsiburadaSku: "HBV1",
                    price: 100,
                  },
                ],
              }),
          };
        },
      });
      const result = await service.sitTestRun("package-status", {
        merchantSku: "SKU1",
        packagePollAttempts: 1,
      });
      assert.equal(result.ok, true);
      assert.ok(
        requests.some((request) =>
          String(request.url).endsWith(
            "/packages/merchantid/merchant-id/packagenumber/PKG-2/intransit",
          ),
        ),
      );
    } finally {
      Object.assign(env, previous);
    }
  });

  test("SIT paket statu testi paket listeleme 500 ise order uzerinden paket olusturmayi dener", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    const requests = [];
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
    });
    try {
      let packageListFailed = false;
      let createdOrderNumber = null;
      const service = new HepsiburadaService({
        environment: "sit",
        fetch: async (url, options = {}) => {
          requests.push({ url, options });
          if (
            String(url).endsWith("/packages/merchantid/merchant-id") &&
            options.method === "POST"
          )
            return {
              ok: true,
              text: async () => JSON.stringify({ packageNumber: "PKG-3" }),
            };
          if (String(url).includes("/packages/merchantid")) {
            if (packageListFailed)
              return {
                ok: true,
                text: async () =>
                  JSON.stringify({ packages: [{ packageNumber: "PKG-3" }] }),
              };
            packageListFailed = true;
            return {
              ok: false,
              status: 500,
              text: async () =>
                JSON.stringify({
                  code: 0,
                  message: "UndefinedError: runtime error",
                }),
            };
          }
          if (String(url).includes("oms-stub-external-sit")) {
            createdOrderNumber = JSON.parse(options.body).OrderNumber;
            return {
              ok: true,
              text: async () => JSON.stringify({}),
            };
          }
          if (String(url).includes("/orders/merchantid/merchant-id"))
            return {
              ok: true,
              text: async () =>
                JSON.stringify({
                  items: [
                    {
                      orderNumber: createdOrderNumber,
                      lineItems: [{ lineItemId: "LINE-3", quantity: 1 }],
                    },
                  ],
                }),
            };
          if (String(url).includes("/listings/merchantid/merchant-id"))
            return {
              ok: true,
              text: async () =>
                JSON.stringify({
                  listings: [
                    {
                      listingId: "listing-1",
                      merchantSku: "SKU1",
                      hepsiburadaSku: "HBV1",
                      price: 100,
                    },
                  ],
                }),
            };
          return {
            ok: true,
            text: async () => JSON.stringify({}),
          };
        },
      });
      const result = await service.sitTestRun("package-status", {
        merchantSku: "SKU1",
        packagePollAttempts: 1,
      });
      assert.equal(result.ok, true);
      assert.ok(
        result.checklist.some(
          (item) => item.title === "Paket bilgisi alinamadi" && !item.ok,
        ),
      );
      assert.ok(
        requests.some((request) =>
          String(request.url).endsWith(
            "/packages/merchantid/merchant-id/packagenumber/PKG-3/deliver",
          ),
        ),
      );
    } finally {
      Object.assign(env, previous);
    }
  });

  test("SIT test runner production ortaminda fail-closed davranir", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
    };
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "production",
        fetch: async () => {
          throw new Error("fetch should not be called");
        },
      });
      await assert.rejects(
        () => service.sitTestRun("listing", { merchantSku: "SKU" }),
        /SIT ortaminda/,
      );
    } finally {
      Object.assign(env, previous);
    }
  });

  test("production fiyat uploadu iki HB mutasyon anahtarini birlikte ister", async () => {
    const previous = {
      hepsiburadaMerchantId: env.hepsiburadaMerchantId,
      hepsiburadaPassword: env.hepsiburadaPassword,
      hepsiburadaUserAgent: env.hepsiburadaUserAgent,
      hepsiburadaMutationsEnabled: env.hepsiburadaMutationsEnabled,
      hepsiburadaPriceUpdatesEnabled: env.hepsiburadaPriceUpdatesEnabled,
    };
    const requests = [];
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaPassword: "secret-key",
      hepsiburadaUserAgent: "aslamacigross_dev",
    });
    try {
      const service = new HepsiburadaService({
        environment: "production",
        fetch: async (url, options) => {
          requests.push({ url, options });
          return {
            ok: true,
            text: async () => JSON.stringify({ id: "price-upload-1" }),
          };
        },
      });
      for (const [mutationsEnabled, priceUpdatesEnabled] of [
        [false, false],
        [true, false],
        [false, true],
      ]) {
        Object.assign(env, {
          hepsiburadaMutationsEnabled: mutationsEnabled,
          hepsiburadaPriceUpdatesEnabled: priceUpdatesEnabled,
        });
        await assert.rejects(
          service.submitPriceUpdate({
            merchantSku: "MSKU1",
            hbSku: "HBCV1",
            price: 123.45,
          }),
          (error) => error.code === "HEPSIBURADA_PRICE_MUTATION_DISABLED",
        );
      }
      assert.equal(requests.length, 0);

      Object.assign(env, {
        hepsiburadaMutationsEnabled: true,
        hepsiburadaPriceUpdatesEnabled: true,
      });
      const result = await service.submitPriceUpdate({
        merchantSku: "MSKU1",
        hbSku: "HBCV1",
        price: 123.45,
      });
      assert.equal(result.uploadId, "price-upload-1");
      assert.equal(requests.length, 1);
      assert.match(String(requests[0].url), /price-uploads$/);
      assert.deepEqual(JSON.parse(requests[0].options.body), [
        {
          hepsiburadaSku: "HBCV1",
          merchantSku: "MSKU1",
          price: 123.45,
        },
      ]);
    } finally {
      Object.assign(env, previous);
    }
  });

  test("eski dogrudan HB fiyat-stok metodu marketplace yazimini reddeder", async () => {
    const service = new HepsiburadaService({ environment: "production" });
    await assert.rejects(
      service.updatePriceAndInventory({ sku: "HBCV1", price: 100 }),
      (error) => error.code === "HEPSIBURADA_REPRICER_EXECUTOR_REQUIRED",
    );
  });
});
