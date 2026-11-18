const {
  evidenceFromResponse,
} = require("../../src/domain/hepsiburada-commission-evidence");
function cashFixture() {
  const now = Date.parse("2026-11-18T00:00:00Z");
  const product = {
    marketplace: "HEPSIBURADA",
    merchant_sku: "86O50O7117229",
    hb_sku: "HBCV-CASH",
    commission_rate: 17,
    my_price: 499,
  };
  const scope = {
    merchantId: "fixture-merchant",
    merchantSku: product.merchant_sku,
    hbSku: product.hb_sku,
  };
  return {
    now,
    product,
    configuredMerchantId: scope.merchantId,
    // Real API is NOT claimed to supply a VAT boolean. Contract supplies basis.
    quote: evidenceFromResponse(
      [{ sku: scope.hbSku, commissionRate: 17 }],
      scope,
      now,
    ),
    contract: {
      source: "HB_APPROVED_CONTRACT",
      merchantId: scope.merchantId,
      revision: "review-fixture-1",
      documentSha256:
        "15f0377c36a4463b4f49ee697f2d98e84b3fcd726e2dfe751ab6cf2be1df94de",
      validFrom: "2026-11-17T00:00:00Z",
      validUntil: "2026-11-19T00:00:00Z",
      rateBasis: "EXCLUDED",
      commissionBase: "LISTING_PRICE",
      roundingProfile: "NET_THEN_VAT_2DP",
      vatEvidence: {
        source: "HB_COMMISSION_INVOICE",
        documentSha256:
          "8f8273b6aebd7a9cf69a6ff43c6a3325488cefc71107accb3b1a61c61a02e0a1",
        rate: 20,
      },
    },
    base: {
      source: "PROVIDER_OWN_LISTING",
      merchantId: scope.merchantId,
      merchantSku: scope.merchantSku,
      hbSku: scope.hbSku,
      amount: 499,
      checkedAt: new Date(now).toISOString(),
    },
    money: {
      buyerRevenue: 499,
      hbFundedDiscount: 0,
      productCost: 310,
      shippingCost: 94.2,
      packagingCost: 5,
      serviceFee: 13.19,
      otherVerifiedCosts: 0,
    },
  };
}
module.exports = { cashFixture };
