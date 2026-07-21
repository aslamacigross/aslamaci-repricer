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
    };
    Object.assign(env, {
      hepsiburadaMerchantId: "merchant-id",
      hepsiburadaUsername: "",
      hepsiburadaPassword: "secret-key",
      hepsiburadaIntegratorKey: "",
      hepsiburadaUserAgent: "aslamacigross_dev",
      hepsiburadaMutationsEnabled: false,
    });
    try {
      const service = new HepsiburadaService({ environment: "sit" });
      assert.equal(service.orderBaseUrl, DEFAULT_ENDPOINTS.sit.orderBaseUrl);
      assert.equal(service.headers()["User-Agent"], "aslamacigross_dev");
      const status = service.runtimeStatus();
      assert.equal(status.environment, "sit");
      assert.equal(status.configured, true);
      assert.equal(status.mutationsEnabled, false);
      assert.equal(JSON.stringify(status).includes("secret-key"), false);
    } finally {
      Object.assign(env, previous);
    }
  });
});
