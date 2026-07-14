const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MappingAutomationService,
  parsePrice,
} = require("../../src/services/mapping-automation.service");

function fixture(overrides = {}) {
  const saved = [];
  const evaluated = [];
  const repository = {
    targetProducts: async () => [
      {
        barcode: "TARGET",
        product_name: "Menekşe Konsantre Yumuşatıcı 1500 ml X 4 Adet",
        brand: "Actisoft",
        category_id: "2354",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [
      {
        barcode: "SOURCE",
        product_name: "Menekşe Konsantre Yumuşatıcı 1500 ml X 2 Adet",
        brand: "Actisoft",
        category_id: "2354",
        cost_item_code: "YUMUSATICI_ACTISOFT_1500ML",
        item_name: "Actisoft Menekşe Yumuşatıcı 1500 ml",
        quantity: 2,
        unit_cost: 110,
        unit_desi: 1.5,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 7,
        product_name: "Actisoft Menekşe Bahçesi Konsantre 1500 ml",
        brand: "Actisoft",
        current_price: 112,
      },
    ],
    costItemsForMatching: async () => [],
    saveSuggestions: async (rows, barcodes = []) => {
      saved.push(...rows);
      evaluated.push(...barcodes);
      return { created: rows.length, skippedApproved: 0, items: rows };
    },
    ...overrides,
  };
  return {
    saved,
    evaluated,
    service: new MappingAutomationService({
      repository,
      costs: { validateMappings: async () => ({ valid: true, errors: [] }) },
      costEngine: { recalculate: async () => ({ processed: 1 }) },
    }),
  };
}

test("Türkçe File fiyat metnini sayıya çevirir", () => {
  assert.equal(parsePrice("1.129,90 TL"), 1129.9);
  assert.equal(parsePrice("112,00 ₺"), 112);
});

test("File import satırını stabil anahtar ve gramajla normalize eder", () => {
  const { service } = fixture();
  const [row] = service.normalizeFileRows([
    { product_name: "Actisoft Menekşe 1500 ml", current_price: "112,00" },
  ]);
  assert.equal(row.current_price, 112);
  assert.equal(row.size_value, 1500);
  assert.equal(row.size_unit, "ml");
  assert.equal(row.source_key.length, 40);
});

test("geçmiş mappingi File fiyatıyla destekleyip hedef adede ölçekler", async () => {
  const { service, saved, evaluated } = fixture();
  const result = await service.generate({ limit: 100 });
  assert.equal(result.created, 1);
  assert.equal(saved[0].barcode, "TARGET");
  assert.equal(saved[0].items[0].quantity, 4);
  assert.equal(saved[0].items[0].suggested_unit_cost, 112);
  assert.equal(saved[0].source_barcode, "SOURCE");
  assert.ok(saved[0].confidence >= 0.9);
  assert.match(saved[0].source_type, /MANUAL_HISTORY/);
  assert.deepEqual(evaluated, ["TARGET"]);
});

test("File havuzundaki markalar dışındaki ürünlere öneri üretmez", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        barcode: "OTHER",
        product_name: "Yaban Mersinli Bitki Çayı 4 Paket",
        brand: "Teekanne",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
  });
  const result = await service.generate({ limit: 100 });
  assert.equal(result.scoped, 0);
  assert.equal(result.eligible, 0);
  assert.equal(saved.length, 0);
});

test("File fiyat desteği bulunmayan adaya mapping önermez", async () => {
  const { service, saved } = fixture({
    fileItemsForMatching: async () => [
      {
        id: 8,
        product_name: "Harras Sütlü Çikolata 80 g",
        brand: "Harras",
        current_price: 47,
      },
    ],
  });
  const result = await service.generate({ limit: 100 });
  assert.equal(result.eligible, 0);
  assert.equal(saved.length, 0);
});

test("30 günden eski File fiyatıyla toplu uygulama önizlemesini engeller", async () => {
  const { service } = fixture({
    getSuggestionsByIds: async () => [
      {
        id: 19,
        barcode: "TARGET",
        status: "APPROVED",
        updated_at: new Date().toISOString(),
        fingerprint: "fixture",
        update_file_price: true,
        source_type: "FILE_MARKET",
        source_barcode: null,
        algorithm_version: "fixture",
        items: [
          {
            cost_item_code: "YUMUSATICI_ACTISOFT_1500ML",
            quantity: 4,
            file_market_item_id: 7,
            file_current_price: 112,
            file_last_seen_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ],
  });
  await assert.rejects(
    service.bulkPreview([19]),
    (error) => error.code === "FILE_PRICE_STALE" && error.status === 409,
  );
});
