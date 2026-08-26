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
    assert.match(call.sql, /p\.marketplace_product_id ILIKE/);
    assert.match(call.sql, /COALESCE\(p\.archived,FALSE\)=FALSE/);
    assert.match(call.sql, /product_settings psf/);
    assert.match(call.sql, /p\.needs_cost_mapping=TRUE/);
    assert.ok(call.params.includes("%Yumuşatıcı%"));
    assert.ok(call.params.includes("%Actisoft%"));
    assert.ok(call.params.includes("MONITOR"));
  }
  assert.match(calls[1].sql, /ORDER BY NULLIF\(p\.product_name,''\)/);
});

test("toplu ayar onizlemesi hedef urun risklerini sayar", async () => {
  const db = {
    query: async () => ({
      rows: [
        {
          barcode: "1",
          product_name: "Tam ürün",
          data_complete: true,
          is_active: true,
          stock_quantity: 3,
          commission_rate: 17,
          needs_cost_mapping: false,
          calculated_net_profit: 42,
          my_price: 120,
          min_price: 100,
        },
        {
          barcode: "2",
          product_name: "Eksik ürün",
          data_complete: false,
          is_active: true,
          stock_quantity: 0,
          commission_rate: 0,
          needs_cost_mapping: true,
          calculated_net_profit: -5,
          my_price: 80,
          min_price: 100,
        },
      ],
    }),
  };

  const preview = await new ProductRepository(db).previewBulkSettings({
    barcodes: ["1", "2"],
  });

  assert.equal(preview.total, 2);
  assert.equal(preview.complete, 1);
  assert.equal(preview.incomplete, 1);
  assert.equal(preview.stocked, 1);
  assert.equal(preview.commissionMissing, 1);
  assert.equal(preview.mappingMissing, 1);
  assert.equal(preview.lossMaking, 1);
  assert.equal(preview.belowMin, 1);
  assert.deepEqual(preview.barcodes, ["1", "2"]);
});
