const test = require("node:test");
const assert = require("node:assert/strict");
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
