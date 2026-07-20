const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ShippingTariffService,
} = require("../../src/services/shipping-tariff.service");

test("Hepsiburada PDF tarifesi 0-4500 desi ve 11 tasiyiciyi korur", () => {
  const service = new ShippingTariffService({ db: null });
  const tariff = service.readHepsiburadaTariff();
  assert.equal(tariff.marketplace, "HEPSIBURADA");
  assert.equal(tariff.effectiveDate, "2026-07-13");
  assert.equal(tariff.vatRate, 20);
  assert.equal(tariff.carriers.length, 11);
  assert.equal(tariff.rows.length, 4501);
  assert.equal(tariff.rows[0][0], 0);
  assert.equal(tariff.rows.at(-1)[0], 4500);
  assert.equal(tariff.rows[0][3], 78.5);
  assert.equal(tariff.rows[61][3], null);
});
