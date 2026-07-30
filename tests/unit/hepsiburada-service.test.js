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
  normalizedEnvironment,
  normalizeRows,
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
      hepsiburadaMutationsEnabled: env.hepsiburadaMutationsEnabled,
      hepsiburadaPriceUpdatesEnabled: env.hepsiburadaPriceUpdatesEnabled,
    };
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaUsername: "",
      hepsiburadaPassword: "secret-key",
      hepsiburadaIntegratorKey: "",
      hepsiburadaUserAgent: "aslamacigross_dev",
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
        { lineItemId: "LINE-1", quantity: 1 },
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
            orderNumber: "ORDER-2",
            lineItems: [{ lineItemId: "LINE-2", quantity: 1 }],
          },
        ],
      },
      "ORDER-1",
    );
    assert.deepEqual(rows, [{ lineItemId: "LINE-1", quantity: 2 }]);
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
      assert.ok(
        requests.some((request) =>
          String(request.url).endsWith(
            "/packages/merchantid/merchant-id/packagenumber/PKG-1/deliver",
          ),
        ),
      );
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
});
