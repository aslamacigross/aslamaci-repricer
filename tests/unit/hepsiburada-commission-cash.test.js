const test = require("node:test");
const assert = require("node:assert/strict");
const {
  commissionCash,
  cashContribution,
  cashSnapshot,
  revalidateCashSnapshot,
  reconcileInvoice,
  cashFloorScenario,
} = require("../../src/domain/hepsiburada-commission-cash");
const { cashFixture } = require("../helpers/hepsiburada-cash-fixture");
const invoices = require("../fixtures/hb-commission-invoices.json");
const { calculateNetProfit } = require("../../src/domain/pricing");
const excluded = (extra) =>
  commissionCash({
    commissionBase: 499,
    skuRate: 17,
    vatRate: 20,
    vatBasis: "EXCLUDED",
    roundingProfile: "NET_THEN_VAT_2DP",
    ...extra,
  });

test("499 / 17 + VAT: 84.83 net + 16.97 VAT = 101.80, charged once", () => {
  assert.deepEqual(excluded(), {
    commissionBase: 499,
    originalSkuRate: 17,
    vatRate: 20,
    vatBasis: "EXCLUDED",
    roundingProfile: "NET_THEN_VAT_2DP",
    net: 84.83,
    vat: 16.97,
    gross: 101.8,
  });
});
test("explicit inclusive rate never receives VAT twice", () => {
  const r = excluded({ skuRate: 20.4, vatBasis: "INCLUDED" });
  assert.equal(r.gross, 101.8);
  assert.equal(r.net + r.vat, r.gross);
});
for (const c of [
  {
    category: "coffee",
    base: 1610.72,
    rate: 17,
    net: 273.82,
    vat: 54.76,
    gross: 328.58,
  },
  {
    category: "cologne",
    base: 340.44,
    rate: 17,
    net: 57.87,
    vat: 11.57,
    gross: 69.44,
  },
  {
    category: "room fragrance",
    base: 739,
    rate: 15,
    net: 110.85,
    vat: 22.17,
    gross: 133.02,
  },
])
  test(`actual HB ${c.category} deduction matches explicit listing base and SKU rate`, () => {
    const r = excluded({ commissionBase: c.base, skuRate: c.rate });
    assert.equal(r.net, c.net);
    assert.equal(r.vat, c.vat);
    assert.equal(r.gross, c.gross);
  });
test("buyer paid amount is not the HB-supported listing commission base", () => {
  assert.equal(excluded({ commissionBase: 1367.61 }).gross, 278.99);
  assert.equal(excluded({ commissionBase: 1610.72 }).gross, 328.58);
});
test("an export effective gross ratio must not become a new net SKU rate", () => {
  assert.notEqual(
    excluded({ commissionBase: 1367.61, skuRate: 24.0258553243 }).gross,
    328.58,
  );
});
test("a SKU-specific discounted rate is preserved instead of replacing it with a category 17", () => {
  const r = excluded({ skuRate: 6 });
  assert.equal(r.originalSkuRate, 6);
  assert.equal(r.gross, 35.93);
});
test("rounding profiles are separate: actual coffee record rules out direct gross rounding", () => {
  assert.equal(excluded({ commissionBase: 1610.72 }).gross, 328.58);
  assert.equal(
    excluded({ commissionBase: 1610.72, roundingProfile: "GROSS_RATE_2DP" })
      .gross,
    328.59,
  );
});
for (const [label, change] of [
  ["missing rate", { skuRate: null }],
  ["unknown VAT", { vatBasis: "UNKNOWN" }],
  ["missing VAT rate", { vatRate: null }],
  ["unknown rounding", { roundingProfile: null }],
  ["unknown base", { commissionBase: undefined }],
])
  test(`${label} cannot become a healthy zero commission`, () =>
    assert.throws(() => excluded(change)));

test("commission correction changes no shipping/service/packaging tax definition", () => {
  const f = cashFixture();
  assert.equal(
    calculateNetProfit({ salePrice: 499, commissionRate: 17, ...f.money }),
    -8.22,
  );
  assert.equal(
    cashContribution({ ...f.money, commission: excluded() }),
    -25.19,
  );
  assert.equal(f.money.shippingCost, 94.2);
  assert.equal(f.money.serviceFee, 13.19);
  assert.throws(() =>
    cashContribution({
      ...f.money,
      otherVerifiedCosts: null,
      commission: excluded(),
    }),
  );
});
for (const [index, gross] of [
  [0, 477.3],
  [1, 5208.38],
  [2, 4144.99],
])
  test(`actual invoice ${index + 1} separates all fees, credits and commission VAT`, () => {
    const r = reconcileInvoice(invoices[index]);
    assert.equal(r.commissionGross, gross);
    assert.equal(r.invoiceGrossTotal, invoices[index].invoiceGrossTotal);
    assert.notEqual(r.invoiceGrossTotal, r.commissionGross);
    assert.equal(r.commissionCashAfterCampaign, null);
    assert.ok(r.blockers.includes("HB_CASH_CREDIT_ALLOCATION_UNVERIFIED"));
    assert.equal(r.pricingAuthorized, false);
  });
test("one-cent invoice/row discrepancy remains visible", () => {
  const r = reconcileInvoice(invoices[0]);
  assert.equal(r.orderVsInvoiceRoundingDelta, 0.01);
  assert.ok(r.blockers.includes("HB_CASH_INVOICE_ROUNDING_UNRESOLVED"));
});
test("invoice mismatch never passes reconciliation", () => {
  assert.throws(() => reconcileInvoice({ ...invoices[0], invoiceVatBase: 1 }), {
    code: "HB_CASH_INVOICE_MISMATCH",
  });
});
test("commission returns reduce commission only, separately from other fees", () => {
  const r = reconcileInvoice({
    commissionNet: 100,
    commissionVatRate: 20,
    otherNetCharges: [{ type: "SHIPPING", amount: 10 }],
    campaignNetCredit: 0,
    commissionReturnNetCredit: 5,
    otherNetCredits: 0,
    invoiceVatBase: 105,
    invoiceVatTotal: 21,
    invoiceGrossTotal: 126,
    orderGrossCommissionSum: 120,
  });
  assert.equal(r.commissionCashAfterCampaign, 114);
  assert.equal(r.invoiceGrossTotal, 126);
});
test("contract supplies EXCLUDED basis when real API does not supply VAT semantics", () => {
  const f = cashFixture(),
    r = cashSnapshot(f);
  assert.equal(f.quote.vatBasis, "UNKNOWN");
  assert.equal(r.evidence.commission.gross, 101.8);
  assert.equal(r.contribution, -25.19);
  assert.equal(r.pricingAuthorized, false);
});
for (const [label, change, code] of [
  [
    "merchant",
    (f) => {
      f.configuredMerchantId = "different";
    },
    "HB_CASH_IDENTITY_UNVERIFIED",
  ],
  [
    "merchant SKU O/0",
    (f) => {
      f.product.merchant_sku = "8605007117229";
    },
    "HB_CASH_IDENTITY_UNVERIFIED",
  ],
  [
    "HB SKU",
    (f) => {
      f.product.hb_sku = "OTHER";
    },
    "HB_CASH_IDENTITY_UNVERIFIED",
  ],
  [
    "TY marketplace",
    (f) => {
      f.product.marketplace = "TRENDYOL";
    },
    "HB_CASH_IDENTITY_UNVERIFIED",
  ],
  [
    "stale quote",
    (f) => {
      f.now += 301000;
    },
    "HB_CASH_QUOTE_STALE",
  ],
  [
    "changed rate",
    (f) => {
      f.product.commission_rate = 15;
    },
    "HB_CASH_RATE_CHANGED",
  ],
  [
    "expired contract",
    (f) => {
      f.contract.validUntil = "2026-11-17T12:00:00Z";
    },
    "HB_CASH_CONTRACT_UNVERIFIED",
  ],
  [
    "wrong contract merchant",
    (f) => {
      f.contract.merchantId = "other";
    },
    "HB_CASH_CONTRACT_UNVERIFIED",
  ],
  [
    "VAT contradiction",
    (f) => {
      f.quote.vatBasis = "INCLUDED";
    },
    "HB_CASH_VAT_CONFLICT",
  ],
  [
    "missing invoice evidence",
    (f) => {
      f.contract.vatEvidence = null;
    },
    "HB_CASH_VAT_UNKNOWN",
  ],
  [
    "own-listing merchant mismatch",
    (f) => {
      f.base.merchantId = "other-merchant";
    },
    "HB_CASH_BASE_UNVERIFIED",
  ],
  [
    "unsupported revenue adjustment",
    (f) => {
      f.money.hbFundedDiscount = 30;
    },
    "HB_CASH_REVENUE_BASE_UNRECONCILED",
  ],
  [
    "unknown market base",
    (f) => {
      f.base.source = "BUYER_PAYMENT";
    },
    "HB_CASH_BASE_UNVERIFIED",
  ],
  [
    "market price mismatch",
    (f) => {
      f.base.amount = 500;
    },
    "MARKET_PRICE_MISMATCH",
  ],
])
  test(`snapshot rejects ${label}`, () => {
    const f = cashFixture();
    change(f);
    assert.throws(() => cashSnapshot(f), { code });
  });

test("current costs, rate, commission base, contract revision bind the snapshot", () => {
  for (const change of [
    (f) => {
      f.money.productCost = 320;
    },
    (f) => {
      f.money.otherVerifiedCosts = 3;
    },
    (f) => {
      f.product.commission_rate = 18;
      f.quote.rate = 18;
    },
    (f) => {
      f.base.amount = 501;
      f.product.my_price = 501;
      f.money.buyerRevenue = 501;
    },
    (f) => {
      f.contract.revision = "new";
    },
  ]) {
    const f = cashFixture(),
      before = cashSnapshot(f);
    change(f);
    assert.throws(() => revalidateCashSnapshot(before, f), {
      code: "STALE_PREVIEW",
    });
  }
});

function floorInput(extra = {}) {
  return {
    money: {
      productCost: 310,
      packagingCost: 5,
      serviceFee: 13.19,
      otherVerifiedCosts: 0,
      commissionRate: 17,
      targetProfit: 50,
    },
    vatBasis: "EXCLUDED",
    vatRate: 20,
    roundingProfile: "NET_THEN_VAT_2DP",
    commissionBaseRule: "LISTING_PRICE",
    minimum: 569.14,
    current: 499,
    desi: 1,
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
    rates: [{ carrier: "hepsiJET", desi_kg: 1, cost_inc_vat: 94.2 }],
    ...extra,
  };
}
test("Obaçay scenario meets 50 TL with VAT, without action/POST permission", () => {
  const r = cashFloorScenario(floorInput());
  assert.equal(r.price, 593.46);
  assert.ok(r.contribution >= 50);
  assert.equal(r.pricingAuthorized, false);
});
for (const c of [
  {
    name: "Ceylon double",
    cost: 450,
    current: 729.99,
    legacyFloor: 737.82,
    cashFloor: 769.34,
  },
  {
    name: "Earl Grey four",
    cost: 300,
    current: 498.99,
    legacyFloor: 557.1,
    cashFloor: 580.89,
  },
])
  test(`reference ${c.name} floor includes commission VAT`, () => {
    const f = floorInput({ minimum: c.legacyFloor, current: c.current });
    f.money.productCost = c.cost;
    const r = cashFloorScenario(f);
    assert.equal(r.price, c.cashFloor);
    assert.ok(r.contribution >= 50);
  });
test("white soap cash floor uses its destination shipping and reaches 200 TL", () => {
  const r = cashFloorScenario(
    floorInput({
      money: {
        productCost: 91,
        packagingCost: 15,
        serviceFee: 13.19,
        otherVerifiedCosts: 0,
        commissionRate: 15,
        targetProfit: 200,
      },
      minimum: 477.16,
      current: 348.99,
    }),
  );
  assert.equal(r.price, 504.13);
  assert.equal(r.shippingCost, 94.2);
  assert.ok(r.contribution >= 200);
});
test("Sensitive destination shipping remains 112.8 in VAT scenario", () => {
  const r = cashFloorScenario(
    floorInput({
      money: {
        productCost: 144,
        packagingCost: 25,
        serviceFee: 13.19,
        otherVerifiedCosts: 0,
        commissionRate: 15,
        targetProfit: 200,
      },
      minimum: 551.28,
      current: 386.87,
      desi: 3,
      rates: [{ carrier: "hepsiJET", desi_kg: 3, cost_inc_vat: 112.8 }],
    }),
  );
  assert.equal(r.shippingCost, 112.8);
  assert.ok(r.contribution >= 200);
  assert.ok(r.price > 582.34);
});
for (const current of [399.98, 399.99, 400])
  test(`destination tariff revalidated at ${current}`, () => {
    const r = cashFloorScenario(floorInput({ current }));
    assert.ok(r.price > current);
    assert.equal(r.shippingCost, 94.2);
    assert.ok(r.contribution >= 50);
  });
test("unknown discounted commission-base mapping blocks a floor", () =>
  assert.throws(
    () =>
      cashFloorScenario(
        floorInput({ commissionBaseRule: "BUYER_PAYMENT_UNKNOWN" }),
      ),
    { code: "HB_CASH_NONLINEAR_BASE_UNVERIFIED" },
  ));
test("contradictory destination tariffs still block", () => {
  const f = floorInput();
  f.barems[1].min_basket = 199;
  assert.throws(() => cashFloorScenario(f), {
    code: "HB_FLOOR_TARIFF_AMBIGUOUS",
  });
});
