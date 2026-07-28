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
  normalizedEnvironment,
  normalizeRows,
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
      const service = new HepsiburadaService({
        environment: "sit",
        fetch: async (url, options = {}) => {
          requests.push({ url, options });
          if (String(url).includes("oms-stub-external-sit"))
            return {
              ok: true,
              text: async () => JSON.stringify({ order: "ok" }),
            };
          if (String(url).includes("/packages/merchantid"))
            return {
              ok: true,
              text: async () => JSON.stringify({ packages: [] }),
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
      const result = await service.sitTestRun("order", { merchantSku: "SKU1" });
      const orderRequest = requests.find((request) =>
        String(request.url).includes("oms-stub-external-sit"),
      );
      const body = JSON.parse(orderRequest.options.body);
      assert.match(body.OrderNumber, /^\d+$/);
      assert.equal(result.ok, true);
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
