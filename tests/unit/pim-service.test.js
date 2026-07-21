const test = require("node:test");
const assert = require("node:assert/strict");
const { PimService } = require("../../src/services/pim.service");

test("listing barkodu açık onay olmadan repository'ye gitmez", async () => {
  let calls = 0;
  const service = new PimService({
    repository: {
      allocateBarcode: async () => {
        calls++;
      },
    },
  });
  await assert.rejects(
    service.allocateBarcode({ marketplace: "N11", recipeId: 7 }),
    (error) => error.code === "BARCODE_ALLOCATION_CONFIRMATION_REQUIRED",
  );
  assert.equal(calls, 0);
});

test("manuel listing barkodu sınırlı güvenli karakter kümesi kullanır", async () => {
  const service = new PimService({ repository: { allocateBarcode: async () => null } });
  await assert.rejects(
    service.allocateBarcode({
      marketplace: "N11",
      recipeId: 7,
      requestedBarcode: "geçersiz barkod!",
      confirmation: "LISTING_BARKODU_TAHSIS_ET",
    }),
    (error) => error.code === "VALIDATION_ERROR",
  );
});
