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
    learningProfiles: async () => [],
    rejectedFingerprints: async () => [],
    rejectedRecipeKeys: async () => [],
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

test("geçmiş mapping yoksa güçlü File ürün eşleşmesinden yeni maliyet kalemi önerir", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "FISTIK",
        product_name: "Harras Fıstık Ezmesi 350 g",
        brand: "Harras",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 18,
        product_name: "Harras Fıstık Ezmesi 350 g",
        brand: "Harras",
        size_value: 350,
        size_unit: "g",
        current_price: 89.95,
      },
    ],
  });

  const result = await service.generate({ limit: 100 });

  assert.equal(result.created, 1);
  assert.equal(saved[0].source_type, "FILE_DIRECT_COST_ITEM");
  assert.equal(saved[0].items[0].file_market_item_id, 18);
  assert.equal(saved[0].items[0].suggested_unit_cost, 89.95);
  assert.equal(saved[0].items[0].unit_desi, 0.35);
  assert.match(saved[0].items[0].cost_item_code, /HARRAS/);
});

test("eski File direkt önerisinde eksik desiyi ürün adından tamamlar", () => {
  const { service } = fixture();
  const [row] = service.normalizeDecisionItems(
    {
      barcode: "8690777453888",
      items: [
        {
          cost_item_code: "HARRAS_HARRAS_BALLI_YER_FISTIK_EZMESI_G_350G",
          quantity: 1,
          file_market_item_id: 18,
          file_product_name: "Harras Ballı Yer Fıstık Ezmesi 350 g",
          file_current_price: 119.5,
          unit_desi: null,
        },
      ],
    },
    [
      {
        cost_item_code: "HARRAS_HARRAS_BALLI_YER_FISTIK_EZMESI_G_350G",
        quantity: 1,
      },
    ],
  );

  assert.equal(row.file_market_item_id, 18);
  assert.equal(row.suggested_unit_cost, 119.5);
  assert.equal(row.unit_desi, 0.35);
});

test("File destekli ölçüsüz öneride varsayılan desiyle cost item oluşturulabilir", () => {
  const { service } = fixture();
  const [row] = service.normalizeDecisionItems(
    {
      barcode: "8695026587958",
      items: [
        {
          cost_item_code: "DAYCARE_DAYCARE_VUCUT_AGDA_BANDI_LI",
          quantity: 5,
          file_market_item_id: 262,
          file_product_name: "Daycare Vücut Ağda Bandı 20'li",
          file_current_price: 89,
          unit_desi: null,
        },
      ],
    },
    [
      {
        cost_item_code: "DAYCARE_DAYCARE_VUCUT_AGDA_BANDI_LI",
        quantity: 5,
      },
    ],
  );

  assert.equal(row.file_market_item_id, 262);
  assert.equal(row.suggested_unit_cost, 89);
  assert.equal(row.unit_desi, 1);
});

test("File ürünü aynı iç paket adedini taşıyorsa ekstra adet çarpanı üretmez", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "BEZ2",
        product_name: "Kurulama Gerektirmeyen Bez 2'li",
        brand: "Actisoft",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 33,
        product_name: "Actisoft Kurulama Gerektirmeyen Bez 2'li",
        brand: "Actisoft",
        current_price: 135,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved[0].items[0].quantity, 1);
  assert.equal(saved[0].items[0].suggested_unit_cost, 135);
});

test("File ürünü iç paket, Trendyol başlığı çoklu paket ise adet çarpanı korunur", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "COP3",
        product_name: "Küçük Boy Çöp Torbası 40'lı x 3 Paket",
        brand: "Actisoft",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 34,
        product_name: "Actisoft Küçük Boy Çöp Torbası 40'lı",
        brand: "Actisoft",
        current_price: 49.5,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved[0].items[0].quantity, 3);
  assert.equal(saved[0].items[0].suggested_unit_cost, 49.5);
});

test("reddedilen aynı öneriyi atlayıp sıradaki güvenilir adayı üretir", async () => {
  const badSource = {
    barcode: "BAD_SOURCE",
    product_name: "Menekşe Konsantre Yumuşatıcı 1500 ml X 2 Adet",
    brand: "Actisoft",
    category_id: "2354",
    cost_item_code: "YANLIS_YUMUSATICI_1500ML",
    item_name: "Actisoft Yanlış Yumuşatıcı 1500 ml",
    quantity: 2,
    unit_cost: 100,
    unit_desi: 1.5,
  };
  const goodSource = {
    barcode: "GOOD_SOURCE",
    product_name: "Menekşe Kokulu Konsantre Yumuşatıcı 1500 ml X 2 Adet",
    brand: "Actisoft",
    category_id: "2354",
    cost_item_code: "DOGRU_YUMUSATICI_1500ML",
    item_name: "Actisoft Menekşe Yumuşatıcı 1500 ml",
    quantity: 2,
    unit_cost: 112,
    unit_desi: 1.5,
  };
  const fileItem = {
    id: 7,
    product_name: "Actisoft Menekşe Bahçesi Konsantre 1500 ml",
    brand: "Actisoft",
    current_price: 112,
  };
  const { service, saved } = fixture({
    trainingRows: async () => [badSource, goodSource],
    fileItemsForMatching: async () => [fileItem],
  });
  const target = (await service.repository.targetProducts())[0];
  const examples = service.groupTrainingRows([badSource, goodSource]);
  const rejectedCandidate = service.buildTrainingCandidates(target, examples, [
    fileItem,
  ])[0];
  const rejectedSuggestion = service.buildSuggestion(target, rejectedCandidate);
  service.repository.rejectedFingerprints = async () => [
    `${rejectedSuggestion.barcode}:${rejectedSuggestion.fingerprint}`,
  ];

  const result = await service.generate({ limit: 100 });

  assert.equal(result.created, 1);
  assert.equal(saved[0].source_barcode, "GOOD_SOURCE");
  assert.equal(saved[0].items[0].cost_item_code, "DOGRU_YUMUSATICI_1500ML");
});

test("kardeş File varyantının fiyatını uyarılı ve kontrollü önerir", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        barcode: "ZEYTIN",
        product_name: "Daycare Zeytin Çiçeği Kolonya 100 ml",
        brand: "Daycare",
        category_id: "123",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [
      {
        barcode: "KIRAZ",
        product_name: "Daycare Kiraz Çiçeği Kolonya 100 ml",
        brand: "Daycare",
        category_id: "123",
        cost_item_code: "DAYCARE_SPREY_KOLONYA_100ML",
        item_name: "Daycare Sprey Kolonya 100 ml",
        quantity: 1,
        unit_cost: 45,
        unit_desi: 0.2,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 9,
        product_name: "Daycare Kiraz Çiçeği Kolonya 100 ml",
        brand: "Daycare",
        current_price: 45,
      },
    ],
  });
  const result = await service.generate({ limit: 100 });
  assert.equal(result.eligible, 1);
  assert.equal(saved[0].confidence_band, "REVIEW");
  assert.equal(saved[0].evidence.variantPriceInferred, true);
  assert.equal(saved[0].evidence.fileMatches[0].priceMode, "SIBLING_VARIANT");
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
