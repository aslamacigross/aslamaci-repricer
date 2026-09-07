const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ActionRepository,
  nextLearningRecommendation,
} = require("../../src/repositories/action.repository");
const { LearningService } = require("../../src/services/learning.service");

test("sonuc jobu taze buybox verisiyle hedef sirayi degerlendirir", async () => {
  let reads = 0;
  let recorded;
  let learned = 0;
  let finalStatus;
  const action = {
    id: 7,
    marketplace: "TRENDYOL",
    barcode: "8690609598109",
    rank_before: 3,
    rank_after: 3,
    target_rank: 2,
  };
  const actions = {
    pendingOutcomes: async () => {
      reads++;
      return [{ ...action, rank_after: reads > 1 ? 2 : 3 }];
    },
    recordOutcome: async (item, outcome) => {
      recorded = outcome;
    },
    applyLearningOutcome: async () => {
      learned++;
    },
    updateStatus: async (id, status) => {
      finalStatus = status;
    },
  };
  const service = new LearningService({
    actions,
    sync: {
      buybox: async () => ({
        processed: 1,
        failed: 0,
        updatedBarcodes: [action.barcode],
      }),
    },
  });
  const result = await service.checkOutcomes(60);
  assert.equal(result.successful, 1);
  assert.equal(recorded.targetAchieved, true);
  assert.equal(recorded.result, "TARGET_RANK_ACHIEVED");
  assert.equal(learned, 1);
  assert.equal(finalStatus, "SUCCESS");
});

test("buybox yenilenemezse eski veriyle sonuc yazilmaz", async () => {
  let recorded = 0;
  const action = { id: 8, barcode: "8695077036402", target_rank: 1 };
  const service = new LearningService({
    actions: {
      pendingOutcomes: async () => [action],
      recordOutcome: async () => {
        recorded++;
      },
    },
    sync: {
      buybox: async () => ({
        processed: 0,
        failed: 1,
        updatedBarcodes: [],
      }),
    },
  });
  const result = await service.checkOutcomes(5);
  assert.equal(result.processed, 0);
  assert.equal(result.refreshFailures, 1);
  assert.equal(recorded, 0);
});

test("buybox korunurken yapilan artis kaybettirirse tek otomatik geri donus olusturur", async () => {
  let recoveryCalls = 0;
  let learningCalls = 0;
  const action = {
    id: 99,
    marketplace: "TRENDYOL",
    barcode: "86956362005698",
    old_price: 638.44,
    proposed_price: 653.44,
    rank_before: 1,
    rank_after: 2,
    buybox_after: 640,
  };
  const service = new LearningService({
    actions: {
      pendingOutcomes: async () => [action],
      recordOutcome: async () => ({ id: 1 }),
      createBuyboxRecovery: async () => {
        recoveryCalls++;
        return { id: 100 };
      },
      applyLearningOutcome: async () => {
        learningCalls++;
      },
    },
    sync: {
      buybox: async () => ({
        processed: 1,
        failed: 0,
        updatedBarcodes: [action.barcode],
      }),
    },
  });
  const result = await service.checkOutcomes(5);
  assert.equal(result.recoveries, 1);
  assert.equal(recoveryCalls, 1);
  assert.equal(learningCalls, 1);
});

test("batch ve pazar fiyati dogrulanmadan aksiyon uygulanmis sayilmaz", async () => {
  let confirmed;
  const action = {
    id: 12,
    barcode: "8690609598109",
    batch_id: "batch-12",
    proposed_price: 312.28,
    sent_at: new Date(),
  };
  const verification = {
    status: "VERIFIED",
    batchResponse: { items: [{ status: "SUCCESS" }] },
    marketProduct: { barcode: action.barcode, salePrice: 312.28 },
  };
  const service = new LearningService({
    actions: {
      pendingVerifications: async () => [action],
      confirmApplied: async (id, result) => {
        confirmed = { id, result };
      },
      pendingOutcomes: async () => [],
    },
    sync: { verifyPriceAction: async () => verification },
  });
  const result = await service.checkOutcomes(5);
  assert.equal(result.verification.verified, 1);
  assert.equal(confirmed.id, action.id);
  assert.equal(confirmed.result.marketProduct.salePrice, 312.28);
});

test("verification ve outcome sorgulari marketplace ile izole edilir", async () => {
  const calls = [];
  const service = new LearningService({
    marketplace: "HEPSIBURADA",
    actions: {
      pendingVerifications: async (...args) => {
        calls.push(["verification", ...args]);
        return [];
      },
      pendingOutcomes: async (...args) => {
        calls.push(["outcome", ...args]);
        return [];
      },
      confirmApplied: async () => {},
    },
    sync: { verifyPriceAction: async () => ({ status: "PENDING" }) },
  });
  await service.checkOutcomes(5);
  assert.deepEqual(calls, [
    ["verification", 200, null, "HEPSIBURADA"],
    ["outcome", 5, null, "HEPSIBURADA"],
  ]);
});

test("ogrenme merkezi basarili en kucuk adimi aciklar", () => {
  assert.match(
    nextLearningRecommendation({
      last_successful_undercut: 6,
      learned_price_cut_tl: 8,
      outcome_count: 3,
      confidence_score: 0.6,
    }),
    /6,00 TL başarılı en küçük/,
  );
});

test("seri basarisizlikta korumali manuel adim onerir", () => {
  assert.match(
    nextLearningRecommendation({
      learned_price_cut_tl: 11,
      consecutive_failures: 2,
      outcome_count: 2,
      confidence_score: 0.2,
    }),
    /manuel onayla; başarısızlık sürerse agresifleşme/,
  );
});

test("ogrenme detayi son fiyat denemelerini sonucuyla getirir", async () => {
  const db = {
    query: async (sql) => {
      if (sql.includes("FROM repricer_learning"))
        return {
          rows: [
            {
              barcode: "8690609598109",
              outcome_count: 1,
              learned_price_cut_tl: 0.1,
              confidence_score: 0.5,
            },
          ],
        };
      return {
        rows: [
          {
            id: 1,
            barcode: "8690609598109",
            result: "BUYBOX_WON",
            elapsed_minutes: 15,
          },
        ],
      };
    },
  };
  const detail = await new ActionRepository(db).learningDetail("8690609598109");
  assert.equal(detail.learning.barcode, "8690609598109");
  assert.equal(detail.attempts[0].result, "BUYBOX_WON");
  assert.match(detail.nextRecommendation, /öğrenilmiş fiyat adımını/i);
});
