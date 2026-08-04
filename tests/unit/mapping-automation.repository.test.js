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
      String(call.sql).includes("IN ($1,$2)"),
  );
  assert.ok(linkLookup);
  assert.deepEqual(linkLookup.params, [2, 1]);
  assert.equal(result.tier_price_updates[0].barcode, "TY-KURABIYE");
  assert.equal(result.tier_price_updates[0].unit_cost, 229);
});

test("mapping aday havuzu aynı tedarikçi ürününden en güncel duplicate kaydı seçer", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return {
        rows: [
          {
            id: 1,
            supplier_code: "FILE_MARKET",
            normalized_name: "harras tereyagli kurabiye 180 g",
            current_price: 195,
            last_seen_at: "2026-07-31T00:00:00.000Z",
          },
          {
            id: 2,
            supplier_code: "FILE_MARKET",
            normalized_name: "harras tereyagli kurabiye 180 g",
            current_price: 229,
            last_seen_at: "2026-08-01T00:00:00.000Z",
          },
          {
            id: 3,
            supplier_code: "FILE_MARKET",
            normalized_name: "gecersiz sifir fiyat",
            current_price: 0,
            last_seen_at: "2026-08-02T00:00:00.000Z",
          },
        ],
      };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  const items = await repo.fileItemsForMatching("FILE_MARKET");

  assert.match(calls[0].sql, /FROM file_market_items/);
  assert.deepEqual(calls[0].params, ["FILE_MARKET"]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 2);
  assert.equal(items[0].current_price, 229);
});

test("tedarikçi havuzu normal listede merge edilmiş eski duplicate kayıtları gizler", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (String(sql).includes("COUNT(*)::int AS total"))
        return { rows: [{ total: 0 }] };
      return { rows: [] };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  await repo.listSupplierItems({ supplierCode: "FILE_MARKET" });

  assert.match(calls[0].sql, /f\.availability<>'MERGED'/);
  assert.match(calls[1].sql, /f\.availability<>'MERGED'/);
});

test("duplicate tedarikçi grubu eski linkleri kanonik kayda taşır ve eski kayıtları merge eder", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (
        String(sql).includes("SELECT id") &&
        String(sql).includes("FOR UPDATE")
      )
        return { rows: [{ id: 9 }, { id: 4 }, { id: 2 }] };
      if (String(sql).includes("UPDATE cost_item_file_links"))
        return { rows: [], rowCount: 3 };
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  const result = await repo.mergeSupplierDuplicateGroup(
    "FILE_MARKET",
    "harras tereyagli kurabiye 180 g",
  );

  assert.equal(result.canonicalItemId, 9);
  assert.deepEqual(result.mergedItemIds, [4, 2]);
  assert.equal(result.movedLinks, 3);
  const linkUpdate = calls.find((call) =>
    String(call.sql).includes("UPDATE cost_item_file_links"),
  );
  assert.deepEqual(linkUpdate.params, [9, [4, 2]]);
  assert.match(linkUpdate.sql, /NOT EXISTS/);
  const conflictUpdate = calls.filter((call) =>
    String(call.sql).includes("UPDATE cost_item_file_links"),
  )[1];
  assert.match(conflictUpdate.sql, /SET status='MERGED'/);
  const itemUpdate = calls.find((call) =>
    String(call.sql).includes("SET availability='MERGED'"),
  );
  assert.deepEqual(itemUpdate.params, [9, [4, 2]]);
});

test("Bizim canlı import boş çoklu fiyatla manuel fiyat kademelerini ezmez", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (String(sql).includes("SELECT * FROM file_market_items"))
        return { rows: [] };
      if (String(sql).includes("INSERT INTO file_market_items"))
        return {
          rows: [
            {
              id: 15,
              supplier_code: "BIZIM_MARKET",
              normalized_name: "teno pecete",
              current_price: 16.9,
              price_tiers: [],
            },
          ],
        };
      if (
        String(sql).includes("SELECT id FROM file_market_items") &&
        String(sql).includes("normalized_name=$2")
      )
        return { rows: [{ id: 15 }] };
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  await repo.importSupplierItems(
    "BIZIM_MARKET",
    [
      {
        source_key: "bizim-web:teno",
        product_name: "Teno Peçete",
        normalized_name: "teno pecete",
        brand: "Teno",
        current_price: 16.9,
        currency: "TRY",
        availability: "AVAILABLE",
        raw_data: {},
        observed_at: "2026-08-01T00:00:00.000Z",
        price_tiers: [],
      },
    ],
    { replaceAvailability: true },
  );

  const upsert = calls.find((call) =>
    String(call.sql).includes("ON CONFLICT(source_key)DO UPDATE"),
  );
  assert.match(
    upsert.sql,
    /WHEN \$19::boolean THEN file_market_items\.price_tiers/,
  );
  assert.equal(upsert.params[18], true);
  assert.doesNotMatch(upsert.sql, /supplier_code=EXCLUDED\.supplier_code/);
});

test("tedarikçi importu aynı kaynak anahtarını başka havuza taşımaz", async () => {
  const db = {
    query: async (sql) => {
      if (String(sql).includes("SELECT * FROM file_market_items"))
        return {
          rows: [
            {
              source_key: "file-api:123",
              supplier_code: "FILE_MARKET",
              current_price: 54.9,
            },
          ],
        };
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  await assert.rejects(
    () =>
      repo.importSupplierItems("BIZIM_MARKET", [
        {
          source_key: "file-api:123",
          product_name: "Actisoft Çamaşır Suyu",
          normalized_name: "actisoft camasir suyu",
          brand: "Actisoft",
          current_price: 54.9,
          currency: "TRY",
          availability: "AVAILABLE",
          raw_data: {},
          observed_at: "2026-08-01T00:00:00.000Z",
          price_tiers: [],
        },
      ]),
    /Tedarikçi kaynak anahtarı çakışıyor/,
  );
});
