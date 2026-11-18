const crypto = require("crypto");
const { AppError } = require("../utils/errors");
const {
  decimalToInteger,
  integerToDecimal,
  divideRounded,
} = require("../utils/numbers");
const { solveHepsiburadaFloor } = require("./hepsiburada-floor");
const { selectShippingCost } = require("./pricing");
const { merchantId } = require("./hepsiburada-merchant-identity");
const { MAX_AGE_MS } = require("./hepsiburada-commission-evidence");

// Isolated economic draft. No production caller, configuration switch, action
// creation, DB write or dispatch permission is supplied by this module.
const MODE = "READ_ONLY_ECONOMIC_DRAFT";
const SCALE = 1000000n;
const cents = (value) => decimalToInteger(value, 2);
const money = (value) => integerToDecimal(value, 2);
const exact = (value) =>
  typeof value === "string" && value.length > 0 && value === value.trim();
function requireCash(ok, code) {
  if (!ok) throw new AppError(code, 409, code);
}
function number(value, code = "HB_CASH_AMOUNT_UNKNOWN") {
  requireCash(
    (typeof value === "number" ||
      (typeof value === "string" && value.trim() !== "")) &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0,
    code,
  );
  return Number(value);
}
function rate(value) {
  const n = number(value, "HB_CASH_RATE_UNKNOWN");
  requireCash(n > 0 && n < 100, "HB_CASH_RATE_UNKNOWN");
  return decimalToInteger(n, 4);
}
const hash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

// `commissionBase` is explicit: never infer it from buyer payment, an export's
// effective percentage, net settlement, or a product's generic tax rate.
function commissionCash({
  commissionBase,
  skuRate,
  vatRate,
  vatBasis,
  roundingProfile,
}) {
  const base = cents(number(commissionBase));
  const r = rate(skuRate);
  const vat = decimalToInteger(number(vatRate, "HB_CASH_VAT_UNKNOWN"), 4);
  requireCash(vat < SCALE, "HB_CASH_VAT_UNKNOWN");
  requireCash(
    ["EXCLUDED", "INCLUDED"].includes(vatBasis),
    "HB_CASH_VAT_BASIS_UNKNOWN",
  );
  requireCash(
    ["NET_THEN_VAT_2DP", "GROSS_RATE_2DP"].includes(roundingProfile),
    "HB_CASH_ROUNDING_UNVERIFIED",
  );
  let net, tax, gross;
  if (vatBasis === "INCLUDED") {
    gross = divideRounded(base * r, SCALE);
    net = divideRounded(gross * SCALE, SCALE + vat);
    tax = gross - net; // no second VAT charge
  } else {
    net = divideRounded(base * r, SCALE);
    if (roundingProfile === "NET_THEN_VAT_2DP") {
      tax = divideRounded(net * vat, SCALE);
      gross = net + tax;
    } else {
      gross = divideRounded(base * r * (SCALE + vat), SCALE * SCALE);
      tax = gross - net;
    }
  }
  return {
    commissionBase: money(base),
    originalSkuRate: Number(skuRate),
    vatRate: Number(vatRate),
    vatBasis,
    roundingProfile,
    net: money(net),
    vat: money(tax),
    gross: money(gross),
  };
}

function cashContribution({
  buyerRevenue,
  hbFundedDiscount,
  productCost,
  shippingCost,
  packagingCost,
  serviceFee,
  otherVerifiedCosts,
  commission,
}) {
  const revenue = cents(number(buyerRevenue)) + cents(number(hbFundedDiscount));
  const expenses = [
    productCost,
    shippingCost,
    packagingCost,
    serviceFee,
    otherVerifiedCosts,
    commission?.gross,
  ].reduce((n, x) => n + cents(number(x)), 0n);
  return money(revenue - expenses);
}

// Before activation, the actual invoice profile and contractual validity must
// be reconciled. This validates an input snapshot for isolated review only.
function cashSnapshot({
  product,
  quote,
  configuredMerchantId,
  contract,
  base,
  money: costs,
  now = Date.now(),
}) {
  requireCash(
    product?.marketplace === "HEPSIBURADA" &&
      exact(product.merchant_sku) &&
      exact(product.hb_sku),
    "HB_CASH_IDENTITY_UNVERIFIED",
  );
  requireCash(
    quote?.source === "HEPSIBURADA_COMMISSION_API" &&
      quote.version === "HB_SKU_COMMISSION_V1" &&
      quote.requestScope === "AUTHENTICATED_MERCHANT_GET",
    "HB_CASH_SOURCE_UNVERIFIED",
  );
  requireCash(
    merchantId(configuredMerchantId) &&
      quote.merchantId === merchantId(configuredMerchantId) &&
      quote.merchantSku === product.merchant_sku &&
      quote.hbSku === product.hb_sku,
    "HB_CASH_IDENTITY_UNVERIFIED",
  );
  const age = now - Date.parse(quote.checkedAt);
  requireCash(
    Number.isFinite(age) && age >= 0 && age <= MAX_AGE_MS,
    "HB_CASH_QUOTE_STALE",
  );
  requireCash(
    Number(quote.rate) === Number(product.commission_rate),
    "HB_CASH_RATE_CHANGED",
  );
  const from = Date.parse(contract?.validFrom),
    until = Date.parse(contract?.validUntil);
  requireCash(
    contract?.source === "HB_APPROVED_CONTRACT" &&
      exact(contract.revision) &&
      contract.merchantId === quote.merchantId &&
      /^[a-f0-9]{64}$/.test(contract.documentSha256 || "") &&
      Number.isFinite(from) &&
      Number.isFinite(until) &&
      from <= now &&
      until >= now &&
      until > from,
    "HB_CASH_CONTRACT_UNVERIFIED",
  );
  requireCash(
    contract.rateBasis === "EXCLUDED" &&
      contract.commissionBase === "LISTING_PRICE",
    "HB_CASH_CONTRACT_UNVERIFIED",
  );
  // Neither synthetic provider VAT booleans nor a product VAT field override
  // the authenticated merchant's separately reviewed contractual basis.
  requireCash(quote.vatBasis !== "INCLUDED", "HB_CASH_VAT_CONFLICT");
  requireCash(
    ["UNKNOWN", "EXCLUDED"].includes(quote.vatBasis),
    "HB_CASH_VAT_BASIS_UNKNOWN",
  );
  requireCash(
    contract.vatEvidence?.source === "HB_COMMISSION_INVOICE" &&
      /^[a-f0-9]{64}$/.test(contract.vatEvidence.documentSha256 || ""),
    "HB_CASH_VAT_UNKNOWN",
  );
  requireCash(
    base?.source === "PROVIDER_OWN_LISTING" &&
      base.merchantId === quote.merchantId &&
      base.merchantSku === quote.merchantSku &&
      base.hbSku === quote.hbSku,
    "HB_CASH_BASE_UNVERIFIED",
  );
  const baseAge = now - Date.parse(base.checkedAt);
  requireCash(
    Number.isFinite(baseAge) && baseAge >= 0 && baseAge <= MAX_AGE_MS,
    "HB_CASH_BASE_STALE",
  );
  requireCash(
    Number(base.amount) === Number(product.my_price),
    "MARKET_PRICE_MISMATCH",
  );
  requireCash(
    cents(number(costs?.buyerRevenue)) +
      cents(number(costs?.hbFundedDiscount)) ===
      cents(number(base.amount)),
    "HB_CASH_REVENUE_BASE_UNRECONCILED",
  );
  const commission = commissionCash({
    commissionBase: base.amount,
    skuRate: quote.rate,
    vatBasis: contract.rateBasis,
    vatRate: contract.vatEvidence.rate,
    roundingProfile: contract.roundingProfile,
  });
  const profit = cashContribution({ ...costs, commission });
  const identity = {
    marketplace: product.marketplace,
    merchantId: quote.merchantId,
    merchantSku: quote.merchantSku,
    hbSku: quote.hbSku,
  };
  const evidence = {
    version: "HB_CASH_DRAFT_V1",
    identity,
    rate: Number(quote.rate),
    base: Number(base.amount),
    commission,
    contract: {
      hash: contract.documentSha256,
      revision: contract.revision,
      validFrom: contract.validFrom,
      validUntil: contract.validUntil,
      vatEvidence: contract.vatEvidence,
    },
    costs: Object.fromEntries(
      [
        "buyerRevenue",
        "hbFundedDiscount",
        "productCost",
        "shippingCost",
        "packagingCost",
        "serviceFee",
        "otherVerifiedCosts",
      ].map((k) => [k, number(costs[k])]),
    ),
  };
  return {
    mode: MODE,
    pricingAuthorized: false,
    evidence,
    contribution: profit,
    fingerprint: hash(evidence),
    observedAt: new Date(now).toISOString(),
  };
}

function revalidateCashSnapshot(previous, inputs) {
  const next = cashSnapshot(inputs);
  requireCash(previous?.fingerprint === next.fingerprint, "STALE_PREVIEW");
  return next;
}

function reconcileInvoice(input) {
  requireCash(Array.isArray(input.otherNetCharges), "HB_CASH_AMOUNT_UNKNOWN");
  const net = cents(number(input.commissionNet));
  const vat = divideRounded(
    net * decimalToInteger(number(input.commissionVatRate), 4),
    SCALE,
  );
  const gross = net + vat;
  const otherNet = input.otherNetCharges.reduce(
    (n, x) => n + cents(number(x.amount)),
    0n,
  );
  const campaign = cents(number(input.campaignNetCredit));
  const commissionReturn = cents(number(input.commissionReturnNetCredit));
  const otherCredits = cents(number(input.otherNetCredits));
  const totalNet = net + otherNet - campaign - commissionReturn - otherCredits;
  const documentTotal = totalNet + cents(number(input.invoiceVatTotal));
  requireCash(
    totalNet === cents(number(input.invoiceVatBase)) &&
      documentTotal === cents(number(input.invoiceGrossTotal)),
    "HB_CASH_INVOICE_MISMATCH",
  );
  const delta = cents(number(input.orderGrossCommissionSum)) - gross;
  return {
    mode: MODE,
    pricingAuthorized: false,
    commissionNet: money(net),
    commissionVat: money(vat),
    commissionGross: money(gross),
    campaignNetCredit: money(campaign),
    commissionReturnNetCredit: money(commissionReturn),
    otherChargesNet: money(otherNet),
    invoiceVatBase: money(totalNet),
    invoiceVatTotal: Number(input.invoiceVatTotal),
    invoiceGrossTotal: money(documentTotal),
    orderVsInvoiceRoundingDelta: money(delta),
    // The PDF discounts several fee types together. Do NOT allocate the entire
    // credit to commission, subtract it twice, or call the invoice total a fee.
    commissionCashAfterCampaign:
      campaign === 0n
        ? money(
            gross -
              commissionReturn -
              divideRounded(
                commissionReturn * decimalToInteger(input.commissionVatRate, 4),
                SCALE,
              ),
          )
        : null,
    blockers: [
      ...(campaign > 0n ? ["HB_CASH_CREDIT_ALLOCATION_UNVERIFIED"] : []),
      ...(delta !== 0n ? ["HB_CASH_INVOICE_ROUNDING_UNRESOLVED"] : []),
    ],
  };
}

function cashFloorScenario(input) {
  requireCash(
    input.commissionBaseRule === "LISTING_PRICE",
    "HB_CASH_NONLINEAR_BASE_UNVERIFIED",
  );
  const m = input.money;
  for (const key of [
    "productCost",
    "packagingCost",
    "serviceFee",
    "otherVerifiedCosts",
    "targetProfit",
  ])
    number(m[key]);
  // Validate semantics before obtaining an estimate from the existing interval
  // solver. A rounded effective rate is only an estimate, never final proof.
  commissionCash({
    commissionBase: 1,
    skuRate: m.commissionRate,
    vatBasis: input.vatBasis,
    vatRate: input.vatRate,
    roundingProfile: input.roundingProfile,
  });
  const r = rate(m.commissionRate),
    v = decimalToInteger(input.vatRate, 4);
  const effective = integerToDecimal(
    input.vatBasis === "EXCLUDED" ? divideRounded(r * (SCALE + v), SCALE) : r,
    4,
  );
  requireCash(effective > 0 && effective < 100, "HB_CASH_RATE_UNKNOWN");
  let minimum = number(input.minimum);
  for (let attempt = 0; attempt < 8; attempt++) {
    const estimate = solveHepsiburadaFloor({
      ...input,
      minimum,
      money: {
        ...m,
        commissionRate: effective,
        serviceFee: money(cents(m.serviceFee) + cents(m.otherVerifiedCosts)),
      },
    });
    const shipping = selectShippingCost({
      salePrice: estimate.price,
      desi: input.desi,
      carrier: input.carrier,
      barems: input.barems,
      costs: input.rates,
    });
    requireCash(
      shipping === estimate.shippingCost && shipping > 0,
      "HB_FLOOR_TARIFF_AMBIGUOUS",
    );
    const commission = commissionCash({
      commissionBase: estimate.price,
      skuRate: m.commissionRate,
      vatRate: input.vatRate,
      vatBasis: input.vatBasis,
      roundingProfile: input.roundingProfile,
    });
    const profit = cashContribution({
      buyerRevenue: estimate.price,
      hbFundedDiscount: 0,
      productCost: m.productCost,
      shippingCost: shipping,
      packagingCost: m.packagingCost,
      serviceFee: m.serviceFee,
      otherVerifiedCosts: m.otherVerifiedCosts,
      commission,
    });
    if (cents(profit) >= cents(m.targetProfit))
      return {
        mode: MODE,
        pricingAuthorized: false,
        price: estimate.price,
        shippingCost: shipping,
        contribution: profit,
        commission,
      };
    minimum = money(cents(estimate.price) + 1n);
  }
  throw new AppError(
    "HB_CASH_NO_STABLE_TARGET",
    409,
    "HB_CASH_NO_STABLE_TARGET",
  );
}

module.exports = {
  MODE,
  commissionCash,
  cashContribution,
  cashSnapshot,
  revalidateCashSnapshot,
  reconcileInvoice,
  cashFloorScenario,
};
