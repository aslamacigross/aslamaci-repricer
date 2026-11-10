const test = require("node:test");
const assert = require("node:assert/strict");
const { solveHepsiburadaFloor } = require("../../src/domain/hepsiburada-floor");
const { calculateNetProfit } = require("../../src/domain/pricing");
function context(extra = {}) {
  return {
    money: {
      productCost: 144,
      packagingCost: 25,
      serviceFee: 13.19,
      commissionRate: 15,
      targetProfit: 200,
    },
    minimum: 551.28,
    current: 386.87,
    desi: 3,
    carrier: "hepsiJET",
    barems: [
      {
        carrier: "hepsiJET",
        min_basket: 0,
        max_basket: 199.99,
        cost_inc_vat: 50.4,
      },
      {
        carrier: "hepsiJET",
        min_basket: 200,
        max_basket: 399.99,
        cost_inc_vat: 86.4,
      },
    ],
    rates: [{ carrier: "hepsiJET", desi_kg: 3, cost_inc_vat: 112.8 }],
    ...extra,
  };
}
test("Sensitive two-pack crosses barem and reaches its unchanged profit target", () => {
  const c = context(),
    result = solveHepsiburadaFloor(c);
  assert.deepEqual(result, { price: 582.34, shippingCost: 112.8 });
  assert.ok(
    calculateNetProfit({
      ...c.money,
      salePrice: result.price,
      shippingCost: result.shippingCost,
    }) >= 200,
  );
});
test("white soap target includes destination shipping", () => {
  const c = context({
    money: {
      productCost: 91,
      packagingCost: 15,
      serviceFee: 13.19,
      commissionRate: 15,
      targetProfit: 200,
    },
    minimum: 477.16,
    current: 348.99,
    desi: 1,
    rates: [{ carrier: "hepsiJET", desi_kg: 1, cost_inc_vat: 94.2 }],
  });
  assert.deepEqual(solveHepsiburadaFloor(c), {
    price: 486.34,
    shippingCost: 94.2,
  });
});
test("Obaçay same tariff preserves 569.14 target", () => {
  const c = context({
    money: {
      productCost: 310,
      packagingCost: 5,
      serviceFee: 13.19,
      commissionRate: 17,
      targetProfit: 50,
    },
    minimum: 569.14,
    current: 499,
    desi: 1,
    rates: [{ carrier: "hepsiJET", desi_kg: 1, cost_inc_vat: 94.2 }],
  });
  assert.deepEqual(solveHepsiburadaFloor(c), {
    price: 569.14,
    shippingCost: 94.2,
  });
});
for (const current of [399.98, 399.99, 400])
  test(`cent boundary ${current} always produces an actual increase`, () => {
    const c = context({ current });
    const r = solveHepsiburadaFloor(c);
    assert.ok(r.price > current);
    assert.equal(r.shippingCost, 112.8);
  });
test("discontinuous cheaper upper tariff chooses boundary, never an oscillating fixed point", () => {
  const c = context({
    minimum: 1,
    current: 250,
    money: {
      productCost: 250,
      packagingCost: 0,
      serviceFee: 0,
      commissionRate: 20,
      targetProfit: 20,
    },
    barems: [
      {
        carrier: "hepsiJET",
        min_basket: 0,
        max_basket: 399.99,
        cost_inc_vat: 100,
      },
    ],
    rates: [{ carrier: "hepsiJET", desi_kg: 3, cost_inc_vat: 10 }],
  });
  assert.deepEqual(solveHepsiburadaFloor(c), { price: 400, shippingCost: 10 });
});
test("overlapping contradictory barems block instead of choosing one", () => {
  const c = context();
  c.barems[1].min_basket = 199;
  assert.throws(() => solveHepsiburadaFloor(c), {
    code: "HB_FLOOR_TARIFF_AMBIGUOUS",
  });
});
test("no tariff for any safe interval blocks", () => {
  assert.throws(() => solveHepsiburadaFloor(context({ rates: [] })), {
    code: "HB_FLOOR_NO_STABLE_TARGET",
  });
});
test("fractional manual desi is blocked rather than changing its semantics", () => {
  assert.throws(() => solveHepsiburadaFloor(context({ desi: 1.5 })), {
    code: "HB_FLOOR_DESI_UNVERIFIED",
  });
});
