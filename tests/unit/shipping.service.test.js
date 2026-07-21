const test = require("node:test");
const assert = require("node:assert/strict");
const { ShippingService } = require("../../src/services/shipping.service");

function fixture() {
  return {
    rates: [
      { carrier: "TEX", desi_kg: 0, cost_inc_vat: 79 },
      { carrier: "TEX", desi_kg: 2, cost_inc_vat: 93.05 },
    ],
    barems: [
      {
        carrier: "TEX",
        min_basket: 0,
        max_basket: 199.99,
        barem_name: "Alt barem",
        cost_inc_vat: 40.99,
      },
    ],
    packaging: [{ min_desi: 0, max_desi: 2, packaging_cost: 15 }],
  };
}

test("kargo onizleme baremi desi tarifesinden once secer", async () => {
  const service = new ShippingService({ shipping: async () => fixture() });
  const result = await service.preview({
    sale_price: 150,
    desi: 1.5,
    carrier: "TEX",
  });
  assert.equal(result.shippingSource, "BAREM");
  assert.equal(result.shippingCost, 40.99);
  assert.equal(result.packagingCost, 15);
  assert.equal(result.totalFulfillmentCost, 55.99);
  assert.deepEqual(result.warnings, []);
});

test("kargo kapsama raporu eksik desi tarifesini gosterir", async () => {
  const service = new ShippingService({ shipping: async () => fixture() });
  const result = await service.coverage();
  assert.deepEqual(result.carriers[0].missingDesi, [1]);
  assert.equal(result.warnings[0].code, "MISSING_DESI_RATE");
});
