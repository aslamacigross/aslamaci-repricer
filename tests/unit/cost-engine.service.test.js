const test = require("node:test");
const assert = require("node:assert/strict");
const { CostEngineService } = require("../../src/services/cost-engine.service");

test("maliyet motoru nihai mapping desisini bir sonraki tam sayıya yuvarlar", async () => {
  const queries = [];
  const db = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes("FROM system_settings")) return { rows: [] };
      return { rowCount: 1, rows: [{ barcode: "TEST", data_complete: true }] };
    },
  };

  const result = await new CostEngineService(db).recalculate("TEST");
  const calculationSql = queries.find((sql) => sql.includes("mapping_totals"));

  assert.equal(result.processed, 1);
  assert.match(
    calculationSql,
    /CEIL\(COALESCE\(mt\.total_desi,0\)\) total_desi/,
  );
  assert.match(calculationSql, /desi=c\.total_desi/);
});
