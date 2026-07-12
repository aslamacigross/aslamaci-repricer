const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ProductRepository,
} = require("../../src/repositories/product.repository");

test("urun filtreleri kategori adi, marka ve repricer modunu birlikte uygular", async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return sql.includes("COUNT(*)")
        ? { rows: [{ count: "0" }] }
        : { rows: [] };
    },
  };

  await new ProductRepository(db).list({
    search: "Menekşe",
    category: "Yumuşatıcı",
    brand: "Actisoft",
    mode: "MONITOR",
    status: "mapping_missing",
  });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.sql, /p\.category_name ILIKE/);
    assert.match(call.sql, /p\.brand ILIKE/);
    assert.match(call.sql, /product_settings psf/);
    assert.match(call.sql, /p\.needs_cost_mapping=TRUE/);
    assert.ok(call.params.includes("%Yumuşatıcı%"));
    assert.ok(call.params.includes("%Actisoft%"));
    assert.ok(call.params.includes("MONITOR"));
  }
});
