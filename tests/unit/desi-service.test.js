const test = require("node:test");
const assert = require("node:assert/strict");
const { DesiService } = require("../../src/services/desi.service");

test("yüksek güvenli desiyi uygular, belirsiz ürünü inceleme kuyruğuna alır", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM cost_items ci"))
        return {
          rows: [
            {
              item_code: "CIKOLATA_25G",
              item_name: "Çikolata 25 g",
              unit_desi: 1,
              supplier_product_name: "Çikolata 25 g",
              estimated_unit_desi: 0.025,
              supplier_confidence: "HIGH",
            },
            {
              item_code: "AGDA_BANDI",
              item_name: "Vücut Ağda Bandı 20'li",
              unit_desi: 1,
              supplier_product_name: "Vücut Ağda Bandı 20'li",
              supplier_confidence: "LOW",
              product_image_url: "https://example.test/agda.jpg",
            },
          ],
        };
      if (sql.includes("SELECT DISTINCT marketplace,barcode"))
        return {
          rows: [
            { marketplace: "TRENDYOL", barcode: "TEST-BARCODE" },
            { marketplace: "HEPSIBURADA", barcode: "TEST-BARCODE" },
          ],
        };
      return { rows: [], rowCount: 1 };
    },
  };
  const recalculated = [];
  const service = new DesiService({
    db,
    costEngine: {
      recalculate: async (barcode, queryable, marketplace) =>
        recalculated.push({ barcode, queryable, marketplace }),
    },
  });
  const result = await service.estimateSupplierCosts();
  assert.equal(result.metadata.updated, 1);
  assert.equal(result.metadata.queued, 1);
  assert.deepEqual(recalculated, [
    {
      barcode: "TEST-BARCODE",
      queryable: undefined,
      marketplace: "TRENDYOL",
    },
    {
      barcode: "TEST-BARCODE",
      queryable: undefined,
      marketplace: "HEPSIBURADA",
    },
  ]);
  assert.ok(
    calls.some(
      (call) =>
        call.sql.includes("UPDATE cost_items SET unit_desi") &&
        call.params[0] === "CIKOLATA_25G" &&
        call.params[1] === 0.025,
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call.sql.includes("INSERT INTO desi_review_queue") &&
        call.params[0] === "AGDA_BANDI",
    ),
  );
});
