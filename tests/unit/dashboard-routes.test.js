const test = require("node:test");
const assert = require("node:assert/strict");
const {
  summarizeRepricerDecision,
  enrichMetricWithRepricerDiagnostics,
} = require("../../src/routes/dashboard.routes");

test("dashboard repricer teşhisi koru kararını açık gösterir", () => {
  const result = summarizeRepricerDecision(
    {
      action: "KORU",
      reason: "Fiyat korunuyor",
      blockedReasons: [],
      proposedPrice: 100,
      difference: 0,
    },
    {},
  );
  assert.equal(result.repricer_decision, "KORU");
  assert.equal(result.repricer_reason, "Fiyat korunuyor");
});

test("dashboard repricer teşhisi dry-run dışındaki güvenlik engellerini gösterir", () => {
  const result = summarizeRepricerDecision(
    {
      action: "FIYAT_DUSUR",
      reason: "1. sıraya kontrollü geçiş",
      blockedReasons: ["DRY_RUN", "MIN_PROFIT_TL_VIOLATION"],
      proposedPrice: 95,
      difference: -5,
    },
    {},
  );
  assert.equal(result.repricer_decision, "SAFETY_BLOCKED");
  assert.deepEqual(result.repricer_blocked_reasons, [
    "MIN_PROFIT_TL_VIOLATION",
  ]);
});

test("dashboard repricer teşhisi açık aksiyonu aksiyon üretilebilirden ayırır", () => {
  const result = summarizeRepricerDecision(
    {
      action: "FIYAT_DUSUR",
      reason: "1. sıraya kontrollü geçiş",
      blockedReasons: [],
      proposedPrice: 95,
      difference: -5,
    },
    { openAction: { id: 10, status: "AWAITING_RESULT" } },
  );
  assert.equal(result.repricer_decision, "OPEN_ACTION_EXISTS");
});

test("dashboard metrik detayını repricer önizlemesiyle zenginleştirir", async () => {
  const detail = {
    type: "products",
    items: [{ barcode: "ABC", product_name: "Ürün" }],
  };
  const result = await enrichMetricWithRepricerDiagnostics(detail, {
    marketplace: "TRENDYOL",
    repricer: {
      preview: async (barcodes, marketplace) => {
        assert.deepEqual(barcodes, ["ABC"]);
        assert.equal(marketplace, "TRENDYOL");
        return [
          {
            barcode: "ABC",
            action: "FIYAT_DUSUR",
            reason: "1. sıraya kontrollü geçiş",
            blockedReasons: [],
            proposedPrice: 95,
            difference: -5,
            targetRank: 1,
            expectedProfit: 40,
          },
        ];
      },
    },
    actions: {
      findOpen: async () => null,
      findPendingIncreaseProbe: async () => null,
    },
  });
  assert.equal(result.items[0].repricer_decision, "AKSIYON_URETILEBILIR");
  assert.equal(result.items[0].repricer_action, "FIYAT_DUSUR");
  assert.equal(result.items[0].repricer_proposed_price, 95);
});
