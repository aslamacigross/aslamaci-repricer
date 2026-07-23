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
    /COALESCE\(p\.manual_desi_override,CEIL\(COALESCE\(mt\.total_desi,0\)\)\) total_desi/,
  );
  assert.match(calculationSql, /desi=c\.total_desi/);
  assert.match(calculationSql, /x\.rule_scope='BARCODE'/);
  assert.match(calculationSql, /x\.rule_scope='PRODUCT_NAME'/);
  assert.match(
    calculationSql,
    /packaging_profile_name=c\.packaging_profile_name/,
  );
});

test("maliyet motoru manuel ürün desi override varsa onu kullanır", async () => {
  const queries = [];
  const db = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes("FROM system_settings")) return { rows: [] };
      return { rowCount: 1, rows: [{ barcode: "PIKNIK" }] };
    },
  };

  await new CostEngineService(db).recalculate("PIKNIK");
  const calculationSql = queries.find((sql) => sql.includes("mapping_totals"));

  assert.match(
    calculationSql,
    /x\.desi_kg=COALESCE\(p\.manual_desi_override,CEIL\(COALESCE\(mt\.total_desi,0\)\)\)/,
  );
  assert.match(
    calculationSql,
    /x\.rule_scope='DESI' AND COALESCE\(p\.manual_desi_override,CEIL\(COALESCE\(mt\.total_desi,0\)\)\) BETWEEN x\.min_desi AND x\.max_desi/,
  );
});

test("Hepsiburada maliyet hesabı yalnız Hepsiburada varsayılanlarını ve ürünlerini kullanır", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM system_settings"))
        return {
          rows: [
            { key: "default_carrier_trendyol", value: "Trendyol Express" },
            { key: "service_fee_trendyol", value: 13.19 },
            { key: "default_carrier_hepsiburada", value: "hepsiJET" },
            { key: "service_fee_hepsiburada", value: 10.5 },
          ],
        };
      return { rowCount: 1, rows: [{ barcode: "ORTAK" }] };
    },
  };

  await new CostEngineService(db).recalculate("ORTAK", db, "HEPSIBURADA");

  const calculation = calls.find((call) => call.sql.includes("mapping_totals"));
  assert.deepEqual(calculation.params, [
    "hepsiJET",
    10.5,
    "HEPSIBURADA",
    "ORTAK",
  ]);
  assert.match(calculation.sql, /WHERE pcm\.marketplace=\$3/);
  assert.match(calculation.sql, /WHERE p\.marketplace=\$3 AND p\.barcode=\$4/);
  assert.match(calculation.sql, /x\.marketplace=p\.marketplace/);
});
