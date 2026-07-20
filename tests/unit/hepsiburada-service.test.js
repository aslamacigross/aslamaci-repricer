const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalHepsiburadaCarrier,
  moneyValue,
  timestamp,
} = require("../../src/services/finance.service");

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
