const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MappingAutomationRepository,
} = require("../../src/repositories/mapping-automation.repository");

test("tedarikçi fiyat güncellemesi aynı ürünün duplicate kayıtlarına bağlı mappingleri de günceller", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (
        String(sql).includes("SELECT id,supplier_code FROM file_market_items")
      )
        return { rows: [{ id: 2, supplier_code: "FILE_MARKET" }] };
      if (String(sql).includes("UPDATE file_market_items SET"))
        return {
          rows: [
            {
              id: 2,
              supplier_code: "FILE_MARKET",
              normalized_name: "harras tereyagli kurabiye 180 g",
              current_price: 229,
              price_tiers: [],
            },
          ],
        };
      if (
        String(sql).includes("SELECT id FROM file_market_items") &&
        String(sql).includes("normalized_name=$2")
      )
        return { rows: [{ id: 2 }, { id: 1 }] };
      if (String(sql).includes("FROM cost_item_file_links l"))
        return {
          rows: [
            {
              marketplace: "TRENDYOL",
              barcode: "TY-KURABIYE",
              cost_item_code: "HARRAS_TEREYAGLI_KURABIYE_180G",
              quantity: 1,
              effective_unit_cost: null,
              previous_unit_cost: 195,
            },
          ],
        };
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  const result = await repo.updateSupplierItemPricing("FILE_MARKET", 2, {
    current_price: 229,
  });

  const linkLookup = calls.find(
    (call) =>
      String(call.sql).includes("FROM cost_item_file_links l") &&
      String(call.sql).includes("ANY($1::int[])"),
  );
  assert.deepEqual(linkLookup.params[0], [2, 1]);
  assert.equal(result.tier_price_updates[0].barcode, "TY-KURABIYE");
  assert.equal(result.tier_price_updates[0].unit_cost, 229);
});

test("mapping aday havuzu aynı tedarikçi ürününden en güncel duplicate kaydı seçer", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  await repo.fileItemsForMatching("FILE_MARKET");

  assert.match(
    calls[0].sql,
    /SELECT DISTINCT ON \(supplier_code,normalized_name\)/,
  );
  assert.match(
    calls[0].sql,
    /ORDER BY supplier_code,normalized_name,last_seen_at DESC/,
  );
  assert.deepEqual(calls[0].params, ["FILE_MARKET"]);
});
