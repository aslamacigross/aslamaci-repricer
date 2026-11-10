const { AppError } = require("../utils/errors");
const {
  calculateMinimumPrice,
  calculateNetProfit,
  selectShippingCost,
} = require("./pricing");
const { roundMoney } = require("../utils/numbers");

function requireFloor(condition, code) {
  if (!condition) throw new AppError(code, 409, code);
}
const finite = (value) =>
  (typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")) &&
  Number.isFinite(Number(value));

// Enumerate tariff intervals, rather than iterating a discontinuous price/cost
// function. Uses existing pricing functions; no new profit/commission formula.
function solveHepsiburadaFloor({
  money,
  minimum,
  current,
  desi,
  carrier,
  barems,
  rates,
}) {
  requireFloor(Number.isInteger(desi) && desi > 0, "HB_FLOOR_DESI_UNVERIFIED");
  requireFloor(
    finite(money.commissionRate) &&
      Number(money.commissionRate) > 0 &&
      Number(money.commissionRate) < 100,
    "HB_FLOOR_COMMISSION_UNVERIFIED",
  );
  for (const key of [
    "productCost",
    "packagingCost",
    "serviceFee",
    "targetProfit",
  ])
    requireFloor(
      finite(money[key]) && Number(money[key]) >= 0,
      "HB_FLOOR_EXPENSE_UNVERIFIED",
    );
  const bs = barems
    .filter((b) => b.carrier === carrier)
    .sort((a, b) => Number(a.min_basket) - Number(b.min_basket));
  const boundaries = new Set([0]);
  let previousMax = -1;
  for (const b of bs) {
    const lo = Number(b.min_basket),
      hi = Number(b.max_basket);
    requireFloor(
      [lo, hi, Number(b.cost_inc_vat)].every(Number.isFinite) &&
        lo >= 0 &&
        hi >= lo &&
        Number(b.cost_inc_vat) > 0 &&
        roundMoney(lo) === lo &&
        roundMoney(hi) === hi &&
        lo > previousMax,
      "HB_FLOOR_TARIFF_AMBIGUOUS",
    );
    previousMax = hi;
    boundaries.add(Math.round(lo * 100));
    boundaries.add(Math.round(hi * 100) + 1);
  }
  const rs = rates.filter(
    (r) => r.carrier === carrier && Number(r.desi_kg) === desi,
  );
  requireFloor(rs.length <= 1, "HB_FLOOR_TARIFF_AMBIGUOUS");
  const points = [...boundaries].sort((a, b) => a - b);
  const candidates = [];
  for (let index = 0; index < points.length; index++) {
    const lower = points[index] / 100,
      upper = (points[index + 1] ?? Infinity) / 100 - 0.01;
    const shippingCost = selectShippingCost({
      salePrice: lower,
      desi,
      carrier,
      barems: bs,
      costs: rs,
    });
    if (!(shippingCost > 0)) continue;
    const input = { ...money, shippingCost };
    let price = roundMoney(
      Math.max(
        Number(minimum),
        Number(current) + 0.01,
        lower,
        calculateMinimumPrice(input),
      ),
    );
    // Existing minimum rounds to cents; one extra cent can be required by the
    // existing commission rounding to meet the profit target exactly.
    if (
      calculateNetProfit({ ...input, salePrice: price }) <
      Number(money.targetProfit)
    )
      price = roundMoney(price + 0.01);
    if (
      price <= upper &&
      calculateNetProfit({ ...input, salePrice: price }) >=
        Number(money.targetProfit)
    )
      candidates.push({ price, shippingCost });
  }
  candidates.sort((a, b) => a.price - b.price);
  requireFloor(candidates.length > 0, "HB_FLOOR_NO_STABLE_TARGET");
  return candidates[0];
}

module.exports = { requireFloor, finite, solveHepsiburadaFloor };
