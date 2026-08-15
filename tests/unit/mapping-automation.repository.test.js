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
      String(call.sql).includes("file_market_item_id IN"),
  );
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
            id: 2,
            supplier_code: "FILE_MARKET",
            normalized_name: "harras kurabiye",
            product_name: "Harras Kurabiye 229",
          },
          {
            id: 1,
            supplier_code: "FILE_MARKET",
            normalized_name: "harras kurabiye",
            product_name: "Harras Kurabiye 195",
          },
          {
            id: 3,
            supplier_code: "FILE_MARKET",
            normalized_name: "harras kakao",
            product_name: "Harras Kakao",
          },
        ],
      };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  const items = await repo.fileItemsForMatching("FILE_MARKET");

  assert.equal(items.length, 2);
  assert.equal(items[0].id, 2);
  assert.equal(items[0].product_name, "Harras Kurabiye 229");
  assert.equal(items[1].id, 3);
  assert.doesNotMatch(calls[0].sql, /SELECT DISTINCT ON/);
  assert.match(
    calls[0].sql,
    /ORDER BY supplier_code,normalized_name,last_seen_at DESC/,
  );
  assert.deepEqual(calls[0].params, ["FILE_MARKET", 10000]);
});

test("mapping aday havuzu supplier bazlı limitlenir ve Rossmann büyük katalogda kesilmez", async () => {
  const rows = [];
  for (let index = 0; index < 6000; index++)
    rows.push({
      id: index + 1,
      supplier_code: "BIM",
      normalized_name: `bim urun ${index}`,
      product_name: `BİM Ürün ${index}`,
    });
  rows.push({
    id: 7001,
    supplier_code: "ROSSMANN",
    normalized_name: "edenland musk latte edp 50 ml",
    product_name: "Edenland Musk Latte EDP 50 ml",
  });
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  const items = await repo.fileItemsForMatching();

  assert.equal(items.length, 6001);
  assert.ok(
    items.some(
      (item) =>
        item.supplier_code === "ROSSMANN" &&
        item.product_name === "Edenland Musk Latte EDP 50 ml",
    ),
  );
  assert.deepEqual(calls[0].params, [50000]);
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

test("Bizim canlı import price tier replace işlemini PDP provenance ile sınırlar", async () => {
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
        raw_data: {
          price_tiers_source: "BIZIM_PRODUCT_DETAIL",
          price_tiers_verified: true,
        },
        observed_at: "2026-08-01T00:00:00.000Z",
        price_tiers: [],
      },
    ],
    { replaceAvailability: true },
  );

  const upsert = calls.find((call) =>
    String(call.sql).includes("ON CONFLICT(source_key)DO UPDATE"),
  );
  assert.match(upsert.sql, /price_tiers=CASE/);
  assert.match(
    upsert.sql,
    /EXCLUDED\.raw_data->>'price_tiers_source'='BIZIM_PRODUCT_DETAIL'/,
  );
  assert.match(
    upsert.sql,
    /EXCLUDED\.raw_data->>'price_tiers_verified'='true'/,
  );
  assert.match(upsert.sql, /THEN EXCLUDED\.price_tiers/);
  assert.match(upsert.sql, /THEN file_market_items\.price_tiers/);
  assert.doesNotMatch(upsert.sql, /supplier_code=EXCLUDED\.supplier_code/);
});

test("File import link olmayan satırlarda canonical ve cost lookup yapmaz", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (String(sql).includes("SELECT DISTINCT f.normalized_name,f.source_key"))
        return { rows: [] };
      if (String(sql).includes("SELECT * FROM file_market_items"))
        return { rows: [] };
      if (String(sql).includes("INSERT INTO file_market_items"))
        return {
          rows: [
            {
              id: 10,
              source_key: "file-api:10",
              supplier_code: "FILE_MARKET",
              normalized_name: "baglantisiz urun",
              current_price: 25,
              availability: "AVAILABLE",
              price_tiers: [],
            },
          ],
        };
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  const result = await repo.importSupplierItems("FILE_MARKET", [
    {
      source_key: "file-api:10",
      product_name: "Bağlantısız Ürün",
      normalized_name: "baglantisiz urun",
      brand: "",
      current_price: 25,
      currency: "TRY",
      availability: "AVAILABLE",
      raw_data: {},
      observed_at: "2026-08-01T00:00:00.000Z",
      price_tiers: [],
    },
  ]);

  assert.equal(result.processed, 1);
  assert.equal(result.costCodesUpdated, 0);
  assert.equal(
    calls.some(
      (call) =>
        String(call.sql).includes("SELECT id FROM file_market_items") &&
        String(call.sql).includes("normalized_name=$2"),
    ),
    false,
  );
  assert.equal(
    calls.some((call) =>
      String(call.sql).includes("LEFT JOIN product_cost_mappings"),
    ),
    false,
  );
});

test("File import canonical duplicate grubunda link varsa cost lookup korunur", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (String(sql).includes("SELECT DISTINCT f.normalized_name,f.source_key"))
        return {
          rows: [
            {
              normalized_name: "harras kurabiye",
              source_key: "file-api:old",
            },
          ],
        };
      if (String(sql).includes("SELECT * FROM file_market_items"))
        return { rows: [] };
      if (String(sql).includes("INSERT INTO file_market_items"))
        return {
          rows: [
            {
              id: 12,
              source_key: "file-api:new",
              supplier_code: "FILE_MARKET",
              normalized_name: "harras kurabiye",
              current_price: 120,
              availability: "AVAILABLE",
              price_tiers: [],
            },
          ],
        };
      if (
        String(sql).includes("SELECT id FROM file_market_items") &&
        String(sql).includes("normalized_name=$2")
      )
        return { rows: [{ id: 12 }, { id: 7 }] };
      if (
        String(sql).includes("FROM cost_item_file_links l") &&
        String(sql).includes("LEFT JOIN product_cost_mappings")
      )
        return {
          rows: [
            {
              cost_item_code: "HARRAS_KURABIYE",
              unit_cost: 110,
              marketplace: "TRENDYOL",
              barcode: "KURABIYE-1",
              quantity: 1,
              effective_unit_cost: null,
              supplier_price_tier: null,
            },
          ],
        };
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  const result = await repo.importSupplierItems("FILE_MARKET", [
    {
      source_key: "file-api:new",
      product_name: "Harras Kurabiye",
      normalized_name: "harras kurabiye",
      brand: "Harras",
      current_price: 120,
      currency: "TRY",
      availability: "AVAILABLE",
      raw_data: {},
      observed_at: "2026-08-01T00:00:00.000Z",
      price_tiers: [],
    },
  ]);

  const canonicalLookup = calls.find(
    (call) =>
      String(call.sql).includes("SELECT id FROM file_market_items") &&
      String(call.sql).includes("normalized_name=$2"),
  );
  assert.deepEqual(canonicalLookup.params, [
    "FILE_MARKET",
    "harras kurabiye",
  ]);
  assert.deepEqual(result.affectedBarcodes, [
    { marketplace: "TRENDYOL", barcode: "KURABIYE-1" },
  ]);
  assert.equal(result.costCodesUpdated, 1);
});

test("Bizim verified PDP tier değişimi linked quantity mapping maliyetini günceller", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (String(sql).includes("SELECT DISTINCT f.normalized_name,f.source_key"))
        return {
          rows: [
            {
              normalized_name: "bizim tier urunu",
              source_key: "bizim-web:tier-safe",
            },
          ],
        };
      if (String(sql).includes("SELECT * FROM file_market_items"))
        return {
          rows: [
            {
              id: 31,
              source_key: "bizim-web:tier-safe",
              supplier_code: "BIZIM_MARKET",
              normalized_name: "bizim tier urunu",
              current_price: 100,
              availability: "AVAILABLE",
              price_tiers: [
                { min_quantity: 16, unit_price: 82, label: "16+ adet" },
              ],
            },
          ],
        };
      if (String(sql).includes("INSERT INTO file_market_items"))
        return {
          rows: [
            {
              id: 31,
              source_key: "bizim-web:tier-safe",
              supplier_code: "BIZIM_MARKET",
              normalized_name: "bizim tier urunu",
              current_price: 100,
              availability: "AVAILABLE",
              price_tiers: [
                { min_quantity: 16, unit_price: 79, label: "16+ adet" },
              ],
            },
          ],
        };
      if (
        String(sql).includes("SELECT id FROM file_market_items") &&
        String(sql).includes("normalized_name=$2")
      )
        return { rows: [{ id: 31 }] };
      if (
        String(sql).includes("FROM cost_item_file_links l") &&
        String(sql).includes("LEFT JOIN product_cost_mappings")
      )
        return {
          rows: [
            {
              cost_item_code: "BIZIM_TIER_ITEM",
              unit_cost: 100,
              marketplace: "TRENDYOL",
              barcode: "BIZIM-TIER-16",
              quantity: 16,
              effective_unit_cost: 82,
              supplier_price_tier: {
                min_quantity: 16,
                unit_price: 82,
                label: "16+ adet",
              },
            },
          ],
        };
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  const result = await repo.importSupplierItems("BIZIM_MARKET", [
    {
      source_key: "bizim-web:tier-safe",
      product_name: "Bizim Tier Ürünü",
      normalized_name: "bizim tier urunu",
      brand: "Teno",
      current_price: 100,
      currency: "TRY",
      availability: "AVAILABLE",
      raw_data: {
        price_tiers_source: "BIZIM_PRODUCT_DETAIL",
        price_tiers_verified: true,
      },
      observed_at: "2026-08-01T00:00:00.000Z",
      price_tiers: [{ min_quantity: 16, unit_price: 79, label: "16+ adet" }],
    },
  ]);

  const mappingUpdate = calls.find((call) =>
    String(call.sql).includes("UPDATE product_cost_mappings SET"),
  );
  assert.deepEqual(mappingUpdate.params.slice(0, 4), [
    "TRENDYOL",
    "BIZIM-TIER-16",
    "BIZIM_TIER_ITEM",
    79,
  ]);
  assert.deepEqual(JSON.parse(mappingUpdate.params[4]), {
    min_quantity: 16,
    unit_price: 79,
    label: "16+ adet",
  });
  assert.deepEqual(result.affectedBarcodes, [
    { marketplace: "TRENDYOL", barcode: "BIZIM-TIER-16" },
  ]);
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

test("tedarikçi importu değişmeyen observation için history yazmaz", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (String(sql).includes("SELECT DISTINCT f.normalized_name,f.source_key"))
        return {
          rows: [
            {
              normalized_name: "domol mendil",
              source_key: "rossmann-api:44",
            },
          ],
        };
      if (String(sql).includes("SELECT * FROM file_market_items"))
        return {
          rows: [
            {
              id: 42,
              source_key: "rossmann-api:42",
              supplier_code: "ROSSMANN",
              normalized_name: "isana sampuan",
              current_price: 149,
              availability: "AVAILABLE",
              raw_data: { effective_price_type: "ROSSMANN_CARD" },
              price_changed_at: "2026-08-01T00:00:00.000Z",
            },
          ],
        };
      if (String(sql).includes("INSERT INTO file_market_items"))
        return {
          rows: [
            {
              id: 42,
              supplier_code: "ROSSMANN",
              normalized_name: "isana sampuan",
              current_price: 149,
              availability: "AVAILABLE",
              raw_data: { effective_price_type: "ROSSMANN_CARD" },
              price_tiers: [],
            },
          ],
        };
      if (
        String(sql).includes("SELECT id FROM file_market_items") &&
        String(sql).includes("normalized_name=$2")
      )
        return { rows: [{ id: 42 }] };
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  const result = await repo.importSupplierItems("ROSSMANN", [
    {
      source_key: "rossmann-api:42",
      product_name: "Isana Şampuan",
      normalized_name: "isana sampuan",
      brand: "Isana",
      current_price: 149,
      currency: "TRY",
      availability: "AVAILABLE",
      raw_data: { effective_price_type: "ROSSMANN_CARD" },
      observed_at: "2026-08-02T00:00:00.000Z",
      price_tiers: [],
    },
  ]);

  assert.equal(result.changed, 0);
  assert.equal(
    calls.some((call) =>
      String(call.sql).includes("INSERT INTO file_market_price_history"),
    ),
    false,
  );
});

test("tedarikçi importu effective price type değişirse history yazar", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (String(sql).includes("SELECT * FROM file_market_items"))
        return {
          rows: [
            {
              id: 43,
              source_key: "rossmann-api:43",
              supplier_code: "ROSSMANN",
              normalized_name: "isana krem",
              current_price: 99,
              availability: "AVAILABLE",
              raw_data: { effective_price_type: "REGULAR" },
              price_changed_at: "2026-08-01T00:00:00.000Z",
            },
          ],
        };
      if (String(sql).includes("INSERT INTO file_market_items"))
        return {
          rows: [
            {
              id: 43,
              supplier_code: "ROSSMANN",
              normalized_name: "isana krem",
              current_price: 99,
              availability: "AVAILABLE",
              raw_data: { effective_price_type: "ROSSMANN_CARD" },
              price_tiers: [],
            },
          ],
        };
      if (
        String(sql).includes("SELECT id FROM file_market_items") &&
        String(sql).includes("normalized_name=$2")
      )
        return { rows: [{ id: 43 }] };
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  await repo.importSupplierItems("ROSSMANN", [
    {
      source_key: "rossmann-api:43",
      product_name: "Isana Krem",
      normalized_name: "isana krem",
      brand: "Isana",
      current_price: 99,
      currency: "TRY",
      availability: "AVAILABLE",
      raw_data: { effective_price_type: "ROSSMANN_CARD" },
      observed_at: "2026-08-02T00:00:00.000Z",
      price_tiers: [],
    },
  ]);

  assert.equal(
    calls.some((call) =>
      String(call.sql).includes("INSERT INTO file_market_price_history"),
    ),
    true,
  );
});

test("tedarikçi importu değişmeyen linked ürün için recalculation adayı üretmez", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (String(sql).includes("SELECT * FROM file_market_items"))
        return {
          rows: [
            {
              id: 44,
              source_key: "rossmann-api:44",
              supplier_code: "ROSSMANN",
              normalized_name: "domol mendil",
              current_price: 69,
              availability: "AVAILABLE",
              raw_data: { effective_price_type: "ROSSMANN_CARD" },
              price_changed_at: "2026-08-01T00:00:00.000Z",
            },
          ],
        };
      if (String(sql).includes("INSERT INTO file_market_items"))
        return {
          rows: [
            {
              id: 44,
              supplier_code: "ROSSMANN",
              normalized_name: "domol mendil",
              current_price: 69,
              availability: "AVAILABLE",
              raw_data: { effective_price_type: "ROSSMANN_CARD" },
              price_tiers: [],
            },
          ],
        };
      if (
        String(sql).includes("SELECT id FROM file_market_items") &&
        String(sql).includes("normalized_name=$2")
      )
        return { rows: [{ id: 44 }] };
      if (
        String(sql).includes("FROM cost_item_file_links l") &&
        String(sql).includes("LEFT JOIN product_cost_mappings")
      )
        return {
          rows: [
            {
              cost_item_code: "DOMOL_MENDIL",
              unit_cost: 69,
              marketplace: "TRENDYOL",
              barcode: "DOMOL-1",
              quantity: 1,
              effective_unit_cost: null,
              supplier_price_tier: null,
            },
          ],
        };
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = new MappingAutomationRepository(db, async (callback) =>
    callback(db),
  );

  const result = await repo.importSupplierItems("ROSSMANN", [
    {
      source_key: "rossmann-api:44",
      product_name: "Domol Mendil",
      normalized_name: "domol mendil",
      brand: "Domol",
      current_price: 69,
      currency: "TRY",
      availability: "AVAILABLE",
      raw_data: { effective_price_type: "ROSSMANN_CARD" },
      observed_at: "2026-08-02T00:00:00.000Z",
      price_tiers: [],
    },
  ]);

  assert.deepEqual(result.affectedBarcodes, []);
  assert.equal(
    calls.some((call) =>
      String(call.sql).includes("UPDATE product_cost_mappings SET"),
    ),
    false,
  );
});
