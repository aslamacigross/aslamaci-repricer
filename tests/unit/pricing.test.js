const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateMinimumPrice,
  calculateNetProfit,
  calculateNetMargin,
  selectShippingCost,
  selectPackagingCost,
  isCostComplete,
} = require("../../src/domain/pricing");

test("Menekşe minimum fiyat fixture 312.28 TL", () => {
  assert.equal(
    calculateMinimumPrice({
      productCost: 112,
      shippingCost: 79,
      packagingCost: 15,
      serviceFee: 13.19,
      targetProfit: 40,
      commissionRate: 17,
    }),
    312.28,
  );
});
test("net kar komisyon ve tum maliyetleri dusurur", () => {
  assert.equal(
    calculateNetProfit({
      salePrice: 312.28,
      commissionRate: 17,
      productCost: 112,
      shippingCost: 79,
      packagingCost: 15,
      serviceFee: 13.19,
    }),
    40,
  );
  assert.equal(
    calculateNetMargin({
      salePrice: 312.28,
      commissionRate: 17,
      productCost: 112,
      shippingCost: 79,
      packagingCost: 15,
      serviceFee: 13.19,
    }),
    12.81,
  );
});
test("sepet baremi desi tarifesinden once gelir", () => {
  const result = selectShippingCost({
    salePrice: 312.28,
    desi: 1.5,
    carrier: "TEX",
    barems: [
      { carrier: "TEX", min_basket: 200, max_basket: 349.99, cost_inc_vat: 79 },
    ],
    costs: [{ carrier: "TEX", desi_kg: 2, cost_inc_vat: 93.05 }],
  });
  assert.equal(result, 79);
});
test("desi ve ambalaj secimi yukari yuvarlanir", () => {
  assert.equal(
    selectShippingCost({
      salePrice: 500,
      desi: 1.5,
      carrier: "TEX",
      costs: [{ carrier: "TEX", desi_kg: 2, cost_inc_vat: 93.05 }],
    }),
    93.05,
  );
  assert.equal(
    selectPackagingCost(1.5, [
      { min_desi: 0, max_desi: 1, packaging_cost: 5 },
      { min_desi: 1, max_desi: 3, packaging_cost: 15 },
    ]),
    15,
  );
});
test("orphan mapping olan urun tamam sayilmaz", () => {
  const base = {
    calculated_product_cost: 112,
    desi: 1.5,
    calculated_shipping_cost: 79,
    min_price: 312.28,
    commission_rate: 17,
  };
  assert.equal(isCostComplete(base), true);
  assert.equal(isCostComplete({ ...base, has_orphan_mapping: true }), false);
});
