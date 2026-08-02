const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MappingAutomationService,
  parsePrice,
} = require("../../src/services/mapping-automation.service");
const {
  MappingAutomationRepository,
} = require("../../src/repositories/mapping-automation.repository");

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
    rejectedSourceBarcodes: async () => [],
    saveSuggestions: async (rows, barcodes = []) => {
      saved.push(...rows);
      evaluated.push(...barcodes);
      return {
        created: rows.length,
        skippedApproved: 0,
        skippedRejected: 0,
        items: rows,
      };
    },
    latestSuggestionsForBarcode: async () => [],
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
  assert.match(row.source_key, /^file-api:manual:[a-f0-9]{40}$/);
});

test("tedarikçi importu başka havuza ait kaynak anahtarını reddeder", () => {
  const { service } = fixture();
  assert.throws(
    () =>
      service.normalizeSupplierRows("BIZIM_MARKET", [
        {
          source_key: "file-api:424",
          product_name: "Actisoft Çamaşır Suyu 1000 ml",
          current_price: "54,90",
        },
      ]),
    /kaynak anahtarı .* havuzuyla uyumlu değil/,
  );
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

test("Hepsiburada mapping önerileri seçili pazaryeriyle izole üretilir", async () => {
  const calls = [];
  const { service, saved } = fixture({
    targetProducts: async (options) => {
      calls.push(["targetProducts", options.marketplace]);
      return [
        {
          barcode: "HB_TARGET",
          product_name: "Menekşe Konsantre Yumuşatıcı 1500 ml X 4 Adet",
          brand: "Actisoft",
          category_id: "2354",
          data_status: "MAPPING_MISSING",
          is_active: true,
        },
      ];
    },
    trainingRows: async (options) => {
      calls.push(["trainingRows", options.marketplace]);
      return [
        {
          marketplace: "TRENDYOL",
          barcode: "TY_SOURCE",
          product_name: "Menekşe Konsantre Yumuşatıcı 1500 ml X 2 Adet",
          brand: "Actisoft",
          category_id: "2354",
          cost_item_code: "YUMUSATICI_ACTISOFT_1500ML",
          item_name: "Actisoft Menekşe Yumuşatıcı 1500 ml",
          quantity: 2,
          unit_cost: 110,
          unit_desi: 1.5,
        },
      ];
    },
    saveSuggestions: async (rows, barcodes, marketplace) => {
      calls.push(["saveSuggestions", marketplace]);
      saved.push(...rows);
      return {
        created: rows.length,
        skippedApproved: 0,
        skippedRejected: 0,
        items: rows,
      };
    },
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 1);
  assert.equal(saved[0].marketplace, "HEPSIBURADA");
  assert.equal(saved[0].barcode, "HB_TARGET");
  assert.deepEqual(calls, [
    ["targetProducts", "HEPSIBURADA"],
    ["trainingRows", "HEPSIBURADA"],
    ["saveSuggestions", "HEPSIBURADA"],
  ]);
});

test("egitim receteleri ayni barkodda pazaryerleri arasinda birbirine karismaz", () => {
  const { service } = fixture();
  const examples = service.groupTrainingRows([
    {
      marketplace: "TRENDYOL",
      barcode: "SAME",
      product_name: "Trendyol ürünü",
      cost_item_code: "TY_COST",
      quantity: 1,
      unit_cost: 10,
      unit_desi: 1,
    },
    {
      marketplace: "HEPSIBURADA",
      barcode: "SAME",
      product_name: "Hepsiburada ürünü",
      cost_item_code: "HB_COST",
      quantity: 1,
      unit_cost: 20,
      unit_desi: 1,
    },
  ]);
  assert.equal(examples.length, 2);
  assert.deepEqual(
    examples.map((example) => [
      example.marketplace,
      example.recipe[0].cost_item_code,
    ]),
    [
      ["TRENDYOL", "TY_COST"],
      ["HEPSIBURADA", "HB_COST"],
    ],
  );
});

test("toplu oneride bekleyen oneriler yeniden taranir, onaylananlar korunur", async () => {
  let capturedSql = "";
  const repository = new MappingAutomationRepository(
    {
      query: async (sql) => {
        capturedSql = String(sql);
        return { rows: [], rowCount: 0 };
      },
    },
    async () => {},
  );
  await repository.targetProducts({ marketplace: "HEPSIBURADA", limit: 1000 });
  assert.match(capturedSql, /LEFT JOIN mapping_suggestions open_suggestion/);
  assert.match(capturedSql, /open_suggestion\.id IS NULL/);
  assert.match(capturedSql, /open_suggestion\.status='APPROVED'/);
  assert.doesNotMatch(capturedSql, /status IN\('PENDING','APPROVED'\)/);
});

test("Hepsiburada mapping önerileri düşük benzerlikte Trendyol reçetesini incelemeye çıkarır", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        marketplace: "HEPSIBURADA",
        barcode: "HB_TEA_TARGET",
        product_name: "Earl Grey Demlik Çay 48'li 3 Paket",
        brand: "Obaçay",
        category_id: "987",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [
      {
        marketplace: "TRENDYOL",
        barcode: "TY_TEA_SOURCE",
        product_name: "Obaçay Earl Grey Bergamot Demlik Poşet Çay 48'li x 3",
        brand: "Obaçay",
        category_id: "987",
        cost_item_code: "OBACAY_EARL_GREY_48LI",
        item_name: "Obaçay Earl Grey Demlik Poşet Çay 48'li",
        quantity: 3,
        unit_cost: 120,
        unit_desi: 1,
      },
    ],
    fileItemsForMatching: async () => [],
    costItemsForMatching: async () => [],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 1);
  assert.equal(saved[0].source_type, "MANUAL_HISTORY");
  assert.equal(saved[0].confidence <= 0.69, true);
  assert.equal(
    saved[0].evidence.learning.confidence <= 0.69 ||
      saved[0].evidence.crossMarketplaceLowConfidence,
    true,
  );
});

test("Hepsiburada katalog barkodu farklı satıcı SKU'sunu Trendyol reçetesine bağlar", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        marketplace: "HEPSIBURADA",
        barcode: "HB-SELLER-SKU-DIFFERENT",
        marketplace_catalog_barcode: "8690609598109",
        product_name: "Actisoft Menekşe Yumuşatıcı 1500 ml x 2",
        brand: "Actisoft",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [
      {
        marketplace: "TRENDYOL",
        barcode: "8690609598109",
        product_name: "Actisoft Menekşe Yumuşatıcı 1,5 L x 2",
        brand: "Actisoft",
        cost_item_code: "ACTISOFT_MENEKSHE_1500ML",
        item_name: "Actisoft Menekşe Yumuşatıcı 1500 ml",
        quantity: 2,
        unit_cost: 112,
        unit_desi: 1.5,
      },
    ],
    fileItemsForMatching: async () => [],
    costItemsForMatching: async () => [],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 1);
  assert.equal(result.catalogBarcodeScoped, 1);
  assert.equal(saved[0].barcode, "HB-SELLER-SKU-DIFFERENT");
  assert.equal(saved[0].source_barcode, "8690609598109");
  assert.equal(saved[0].source_type, "CATALOG_BARCODE_RECIPE");
  assert.equal(saved[0].evidence.catalogBarcodeMatch, true);
  assert.equal(saved[0].items[0].quantity, 2);
});

test("Hepsiburada katalog barkodu marka alani farkliyken eslesmeyi incelemeye cikarir", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        marketplace: "HEPSIBURADA",
        barcode: "HB-CATALOG-PRIVATE-BRAND",
        marketplace_catalog_barcode: "8690609598109",
        product_name: "Menekşe Yumuşatıcı 1500 ml x 2",
        brand: "Aşlamacı Bakliyat",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [
      {
        marketplace: "TRENDYOL",
        barcode: "8690609598109",
        product_name: "Actisoft Menekşe Yumuşatıcı 1,5 L x 2",
        brand: "Actisoft",
        cost_item_code: "ACTISOFT_MENEKSHE_1500ML",
        item_name: "Actisoft Menekşe Yumuşatıcı 1500 ml",
        quantity: 2,
        unit_cost: 112,
        unit_desi: 1.5,
      },
    ],
    fileItemsForMatching: async () => [],
    costItemsForMatching: async () => [],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.catalogBarcodeScoped, 1);
  assert.equal(saved[0].source_type, "CATALOG_BARCODE_RECIPE");
  assert.notEqual(saved[0].confidence_band, "HIGH");
  assert.equal(saved[0].evidence.crossMarketplaceBrandMismatch, true);
});

test("aynı katalog barkodunda varyant uyuşmazlığı öneriyi engeller", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        marketplace: "HEPSIBURADA",
        barcode: "HB-CICEK",
        marketplace_catalog_barcode: "8690000000002",
        product_name: "Actisoft Çiçek Rüyası Yumuşatıcı 1500 ml",
        brand: "Actisoft",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [
      {
        marketplace: "TRENDYOL",
        barcode: "8690000000002",
        product_name: "Actisoft Menekşe Yumuşatıcı 1500 ml",
        brand: "Actisoft",
        cost_item_code: "ACTISOFT_MENEKSHE_1500ML",
        item_name: "Actisoft Menekşe Yumuşatıcı 1500 ml",
        quantity: 1,
        unit_cost: 112,
        unit_desi: 1.5,
      },
    ],
    fileItemsForMatching: async () => [],
    costItemsForMatching: async () => [],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 0);
  assert.equal(result.catalogBarcodeScoped, 0);
  assert.equal(saved.length, 0);
});

test("Hepsiburada es anlamli temizlik urununu Trendyol recetesinden incelemeye cikarir", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        marketplace: "HEPSIBURADA",
        barcode: "HB-BLEACH",
        product_name: "Actisoft Çam Ultra Çamaşır Suyu 1000 ml",
        brand: "Actisoft",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [
      {
        marketplace: "TRENDYOL",
        barcode: "TY-BLEACH",
        product_name: "Actisoft Ekstra Yoğun Çamaşır Suyu 1 L",
        brand: "Actisoft",
        cost_item_code: "ACTISOFT_CAMASIR_SUYU_1L",
        item_name: "Actisoft Çamaşır Suyu 1 L",
        quantity: 1,
        unit_cost: 54.9,
        unit_desi: 1,
      },
    ],
    fileItemsForMatching: async () => [],
    costItemsForMatching: async () => [],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 1);
  assert.equal(result.recipeScoped, 1);
  assert.equal(saved[0].source_type, "MANUAL_HISTORY");
  assert.equal(saved[0].confidence_band, "LOW");
  assert.equal(saved[0].items[0].cost_item_code, "ACTISOFT_CAMASIR_SUYU_1L");
});

test("Hepsiburada varyanti farkli yumusaticiyi ayni recete saymaz", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        marketplace: "HEPSIBURADA",
        barcode: "HB-MENEKSHE",
        product_name: "Actisoft Menekşe Yumuşatıcı 1500 ml",
        brand: "Actisoft",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [
      {
        marketplace: "TRENDYOL",
        barcode: "TY-CICEK-RUYASI",
        product_name: "Actisoft Çiçek Rüyası Yumuşatıcı 1,5 L",
        brand: "Actisoft",
        cost_item_code: "ACTISOFT_CICEK_RUYASI_1500ML",
        item_name: "Actisoft Çiçek Rüyası Yumuşatıcı 1500 ml",
        quantity: 1,
        unit_cost: 112,
        unit_desi: 1.5,
      },
    ],
    fileItemsForMatching: async () => [],
    costItemsForMatching: async () => [],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 0);
  assert.equal(result.recipeScoped, 0);
  assert.equal(saved.length, 0);
});

test("Hepsiburada mevcut maliyet kalemini dusuk guvenli yedek aday olarak kullanir", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        marketplace: "HEPSIBURADA",
        barcode: "HB-CHAIR",
        product_name: "Best Choice Kamp Sandalyesi",
        brand: "Best Choice",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [],
    fileItemsForMatching: async () => [],
    costItemsForMatching: async () => [
      {
        item_code: "BEST_CHOICE_KAMP_SANDALYESI",
        item_name: "Best Choice Kamp Sandalyesi",
        unit_cost: 149.9,
        unit_desi: 3,
      },
    ],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 1);
  assert.equal(result.costCatalogScoped, 1);
  assert.equal(saved[0].source_type, "COST_ITEM_CATALOG");
  assert.equal(saved[0].confidence_band, "LOW");
  assert.equal(saved[0].update_file_price, false);
  assert.equal(saved[0].items[0].cost_item_code, "BEST_CHOICE_KAMP_SANDALYESI");
});

test("Hepsiburada mappingi urun turu celisen dusuk skorlu adaylari onermez", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        marketplace: "HEPSIBURADA",
        barcode: "HB-INCIR",
        product_name: "Harras Kuru İncir 300 g",
        brand: "Harras",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [],
    fileItemsForMatching: async () => [
      {
        id: 11,
        product_name: "Harras Az Tuzlu Kuru Sele Zeytin 300 g",
        brand: "Harras",
        current_price: 99,
        supplier_code: "FILE_MARKET",
      },
    ],
    costItemsForMatching: async () => [],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 0);
  assert.equal(saved.length, 0);
});

test("Hepsiburada mappingi guclu tedarikci eslesmesini zayif gecmise tercih eder", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        marketplace: "HEPSIBURADA",
        barcode: "HB-KAKAO-DIRECT",
        product_name: "Ülker Toz Kakao 150 g",
        brand: "Ülker",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [
      {
        marketplace: "TRENDYOL",
        barcode: "TY-KAKAO-WEAK",
        product_name: "Ülker Kakao Aromalı Bisküvi 150 g",
        brand: "Ülker",
        cost_item_code: "YANLIS_BISKUVI",
        item_name: "Ülker Bisküvi",
        quantity: 1,
        unit_cost: 40,
        unit_desi: 1,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 12,
        product_name: "Ülker Toz Kakao 150 g",
        brand: "Ülker",
        current_price: 89,
        supplier_code: "BIZIM_MARKET",
        estimated_unit_desi: 1,
      },
    ],
    costItemsForMatching: async () => [],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 1);
  assert.equal(saved[0].supplier_code, "BIZIM_MARKET");
  assert.equal(saved[0].items[0].file_product_name, "Ülker Toz Kakao 150 g");
  assert.notEqual(saved[0].items[0].cost_item_code, "YANLIS_BISKUVI");
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

test("manuel uygulanmış mapping geçmişi tedarikçi havuzu olmadan yeni öneri üretir", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        barcode: "MANUAL_TARGET",
        product_name: "Teno Ekonomik Peçete 100'lü X 6 Adet",
        brand: "Teno",
        category_id: "123",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    trainingRows: async () => [
      {
        barcode: "MANUAL_SOURCE",
        product_name: "Teno Ekonomik Peçete 100'lü",
        brand: "Teno",
        category_id: "123",
        cost_item_code: "TENO_PECETE_100LU",
        item_name: "Teno Ekonomik Peçete 100'lü",
        quantity: 1,
        unit_cost: 16.9,
        unit_desi: 1,
      },
    ],
    fileItemsForMatching: async () => [],
    costItemsForMatching: async () => [],
  });

  const result = await service.generate({ limit: 100 });

  assert.equal(result.created, 1);
  assert.equal(result.scoped, 1);
  assert.equal(saved[0].source_type, "MANUAL_HISTORY");
  assert.equal(saved[0].update_file_price, false);
  assert.equal(saved[0].file_market_item_id, null);
  assert.equal(saved[0].items[0].file_market_item_id, null);
  assert.equal(saved[0].items[0].cost_item_code, "TENO_PECETE_100LU");
  assert.equal(Number(saved[0].items[0].quantity), 6);
});

test("farklı tedarikçi havuzlarını tek mapping reçetesinde karıştırmaz", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "ULKER36",
        product_name: "Ülker Çikolatalı Gofret 36 g 36'lı",
        brand: "Ülker",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 101,
        supplier_code: "BIZIM_MARKET",
        product_name: "Ülker Çikolatalı Gofret 36 g 36'lı",
        brand: "Ülker",
        current_price: 475.21,
        estimated_unit_desi: 1.296,
      },
      {
        id: 202,
        supplier_code: "BIM",
        product_name: "Ülker Çikolatalı Gofret 36 g",
        brand: "Ülker",
        current_price: 16,
        estimated_unit_desi: 0.036,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved.length, 1);
  assert.equal(
    new Set(saved[0].items.map((item) => item.supplier_code)).size,
    1,
  );
  assert.equal(saved[0].supplier_code, saved[0].items[0].supplier_code);
});

test("File fiyat desteği bulunmayan adaya mapping önermez", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
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

test("güvenli aday kalmadığında düşük güvenli File adayını manuel kontrole önerir", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "LOWFILE",
        product_name: "Actisoft Bez",
        brand: "Actisoft",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 82,
        product_name: "Actisoft Bulaşık Süngeri",
        brand: "Actisoft",
        current_price: 24,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].confidence_band, "LOW");
  assert.equal(saved[0].items[0].file_product_name, "Actisoft Bulaşık Süngeri");
});

test("mapping teşhisi düşük güvenli üretilebilir adayı görünür yapar", async () => {
  const { service } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "LOWDIAG",
        product_name: "Actisoft Bez",
        brand: "Actisoft",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 82,
        product_name: "Actisoft Bulaşık Süngeri",
        brand: "Actisoft",
        current_price: 24,
      },
    ],
  });

  const result = await service.diagnostics({ limit: 100 });

  assert.equal(result.processed, 1);
  assert.equal(result.items[0].diagnosis, "LOW_CONFIDENCE_AVAILABLE");
  assert.equal(result.summary.LOW_CONFIDENCE_AVAILABLE, 1);
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

test("Daycare banyo sabununu File kalıp sabun ürünüyle önerir", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "TYBGRQD9451MF7S999",
        product_name: "Doğal Beyaz Banyo Sabunu 4 X 200 Gr",
        brand: "Daycare",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 77,
        product_name: "Daycare Kalıp Sabun 4x200 g",
        brand: "Daycare",
        current_price: 69.5,
      },
    ],
  });

  const result = await service.generate({ limit: 100 });

  assert.equal(result.created, 1);
  assert.equal(saved[0].source_type, "FILE_DIRECT_COST_ITEM");
  assert.equal(saved[0].items[0].file_market_item_id, 77);
  assert.equal(saved[0].items[0].quantity, 1);
  assert.equal(saved[0].items[0].unit_desi, 0.8);
});

test("teşhis önerisi onaylı öneri yüzünden kaydedilmezse sebebini döndürür", async () => {
  const approvedSuggestion = {
    id: 91,
    barcode: "TYBGRQD9451MF7S999",
    status: "APPROVED",
  };
  const { service } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "TYBGRQD9451MF7S999",
        product_name: "Doğal Beyaz Banyo Sabunu 4 X 200 Gr",
        brand: "Daycare",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 77,
        product_name: "Daycare Kalıp Sabun 4x200 g",
        brand: "Daycare",
        current_price: 69.5,
      },
    ],
    saveSuggestions: async () => ({
      created: 0,
      skippedApproved: 1,
      skippedRejected: 0,
      items: [],
    }),
    latestSuggestionsForBarcode: async (barcode, statuses) => {
      assert.equal(barcode, "TYBGRQD9451MF7S999");
      assert.deepEqual(statuses, ["APPROVED"]);
      return [approvedSuggestion];
    },
  });

  const result =
    await service.regenerateDiagnosticBarcode("TYBGRQD9451MF7S999");

  assert.equal(result.created, 0);
  assert.equal(result.reason, "APPROVED_EXISTS");
  assert.deepEqual(result.existingSuggestions, [approvedSuggestion]);
});

test("farklı File ürünlerinden oluşan setlerde çoklu maliyet kalemi önerir", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "KARMA_SET",
        product_name:
          "Harras Fındık Kremalı Bisküvi ve Çilek Kremalı Bisküvi Seti",
        brand: "Harras",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 31,
        product_name: "Harras Fındık Kremalı Bisküvi 240 g",
        brand: "Harras",
        current_price: 119,
      },
      {
        id: 32,
        product_name: "Harras Çilek Kremalı Bisküvi 240 g",
        brand: "Harras",
        current_price: 119,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].source_type, "FILE_COMPOSITE_COST_ITEMS");
  assert.equal(saved[0].items.length, 2);
  assert.deepEqual(
    saved[0].items.map((item) => item.file_market_item_id).sort(),
    [31, 32],
  );
  assert.equal(saved[0].evidence.compositeProduct, true);
});

test("farklı ürünlü set tek File ürününe indirgenirse yüksek güvene çıkmaz", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "YARIM_SET",
        product_name:
          "Harras Fındık Kremalı Bisküvi ve Çilek Kremalı Bisküvi Seti",
        brand: "Harras",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 31,
        product_name: "Harras Fındık Kremalı Bisküvi 240 g",
        brand: "Harras",
        current_price: 119,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].items.length, 1);
  assert.equal(saved[0].evidence.compositeReviewNeeded, true);
  assert.ok(saved[0].confidence <= 0.69);
  assert.equal(saved[0].confidence_band, "LOW");
});

test("karabiber setinde değirmen kapak 50 g ve tane 100 g ayrı kalem olur", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "TYBNU3EM9A5KGJWA79",
        product_name:
          "Harras Değirmen Kapak Tane Karabiber 50 g ve Harras Tane Karabiber 100 g Set",
        brand: "Harras",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 41,
        product_name: "Harras Değirmen Kapak Tane Karabiber 50g",
        brand: "Harras",
        current_price: 109,
      },
      {
        id: 42,
        product_name: "Harras Tane Karabiber 100g",
        brand: "Harras",
        current_price: 97.5,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].items.length, 2);
  assert.deepEqual(
    saved[0].items.map((item) => item.file_market_item_id).sort(),
    [41, 42],
  );
  assert.deepEqual(
    saved[0].items
      .map((item) => Number(item.suggested_unit_cost))
      .sort((left, right) => left - right),
    [97.5, 109],
  );
});

test("kahve varyant setinde dört File ürünü ayrı maliyet kalemi olur", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "528528268",
        product_name:
          "Harras Guatemala Colombia Colombia Medium Roast Special Blend Filtre Kahve 250 g 4'lü Set",
        brand: "Harras",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 51,
        product_name: "Harras Guatemala Filtre Kahve 250g",
        brand: "Harras",
        current_price: 229,
      },
      {
        id: 52,
        product_name: "Harras Colombia Filtre Kahve 250g",
        brand: "Harras",
        current_price: 229,
      },
      {
        id: 53,
        product_name: "Harras Colombia Medium Roast Filtre Kahve 250g",
        brand: "Harras",
        current_price: 229,
      },
      {
        id: 54,
        product_name: "Harras Special Blend Filtre Kahve 250g",
        brand: "Harras",
        current_price: 199,
      },
      {
        id: 561,
        product_name: "Harras Pratik Filtre Kahve Tekli",
        brand: "Harras",
        current_price: 11.5,
      },
      {
        id: 377,
        product_name: "Harras Pratik Filtre Kahve Tekli",
        brand: "Harras",
        current_price: 11.5,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].source_type, "FILE_MULTI_VARIANT_COST_ITEMS");
  assert.equal(saved[0].items.length, 4);
  assert.deepEqual(
    saved[0].items.map((item) => item.file_market_item_id).sort(),
    [51, 52, 53, 54],
  );
  assert.ok(
    saved[0].items.every(
      (item) => !item.file_product_name.toLowerCase().includes("pratik"),
    ),
  );
  assert.equal(saved[0].evidence.multiVariantProduct, true);
});

test("aynı temizlenmiş cost code üreten çoklu File kalemleri benzersizleştirilir", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "DUPLICATE_CODES",
        product_name:
          "Harras Guatemala Filtre Kahve 250 g ve Harras Guatemala Filtre Kahve 250 g Set",
        brand: "Harras",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 61,
        product_name: "Harras Guatemala Filtre Kahve 250g",
        brand: "Harras",
        current_price: 229,
      },
      {
        id: 62,
        product_name: "Harras Guatemala Filtre Kahve 250g",
        brand: "Harras",
        current_price: 229,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].items.length, 2);
  assert.equal(
    new Set(saved[0].items.map((item) => item.cost_item_code)).size,
    2,
  );
  assert.deepEqual(
    saved[0].items
      .map((item) => item.cost_item_code.match(/_F\d+$/)?.[0])
      .sort(),
    ["_F61", "_F62"],
  );
  assert.deepEqual(
    saved[0].evidence.fileMatches.map((match) => match.costItemCode).sort(),
    saved[0].items.map((item) => item.cost_item_code).sort(),
  );
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

test("File destekli ölçüsüz öneride temkinli varsayılan desi kullanılır", () => {
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
  assert.equal(row.unit_desi, 0.25);
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

test("File ürünü 50'li paket ise Trendyol adındaki 50 adet içeriği maliyet adedi sayılmaz", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    targetProducts: async () => [
      {
        barcode: "DISIPI50",
        product_name: "Kürdanlı Diş İpi 50 Adet",
        brand: "Daycare",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 50,
        product_name: "Daycare Bioçözünür Kürdanlı Diş İp 50'li",
        brand: "Daycare",
        current_price: 89,
      },
      {
        id: 51,
        product_name: "Daycare Diş İpi Ferah 50 m",
        brand: "Daycare",
        current_price: 75,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved[0].items[0].quantity, 1);
  assert.equal(
    saved[0].items[0].file_product_name,
    "Daycare Bioçözünür Kürdanlı Diş İp 50'li",
  );
  assert.equal(saved[0].items[0].suggested_unit_cost, 89);
});

test("ret notu doğru File ürününü ve adet düzeltmesini sonraki öneriye taşır", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    rejectedFeedbackHints: async () => [
      {
        barcode: "DISIPI50NOTE",
        reason:
          "Bu ürün Daycare Diş İpi Ferah 50 m değil. Doğru ürün Daycare Bioçözünür Kürdanlı Diş İp 50'li. Adet 1 olmalı, 50 adet paket içeriği.",
      },
    ],
    targetProducts: async () => [
      {
        barcode: "DISIPI50NOTE",
        product_name: "Daycare Diş İpi 50 Adet",
        brand: "Daycare",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 51,
        product_name: "Daycare Diş İpi Ferah 50 m",
        brand: "Daycare",
        current_price: 75,
      },
      {
        id: 50,
        product_name: "Daycare Bioçözünür Kürdanlı Diş İp 50'li",
        brand: "Daycare",
        current_price: 89,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(
    saved[0].items[0].file_product_name,
    "Daycare Bioçözünür Kürdanlı Diş İp 50'li",
  );
  assert.equal(saved[0].items[0].quantity, 1);
  assert.equal(saved[0].items[0].suggested_unit_cost, 89);
  assert.equal(saved[0].evidence.rejectionNoteHints.quantityForcedToOne, true);
});

test("ret notundaki çoklu doğru reçeteyi File destekli mapping önerisine çevirir", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    rejectedFeedbackHints: async () => [
      {
        barcode: "TYBNU3EM9A5KGJWA79",
        reason:
          "DOĞRU: Harras Değirmen Kapak Tane Karabiber 50g - 109₺ ve Harras Tane Karabiber 100g - 97,5₺",
      },
    ],
    targetProducts: async () => [
      {
        barcode: "TYBNU3EM9A5KGJWA79",
        product_name: "Harras Karabiber Seti",
        brand: "Harras",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 41,
        product_name: "Harras Değirmen Kapak Tane Karabiber 50 g",
        brand: "Harras",
        current_price: 109,
      },
      {
        id: 42,
        product_name: "Harras Tane Karabiber 100 g",
        brand: "Harras",
        current_price: 97.5,
      },
      {
        id: 43,
        product_name: "Harras Karabiber 40 g",
        brand: "Harras",
        current_price: 69,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved[0].source_type, "FEEDBACK_EXPLICIT_FILE_RECIPE");
  assert.equal(saved[0].items.length, 2);
  assert.deepEqual(
    saved[0].items.map((item) => item.file_market_item_id).sort(),
    [41, 42],
  );
  assert.deepEqual(
    saved[0].items.map((item) => item.quantity),
    [1, 1],
  );
  assert.equal(saved[0].evidence.explicitFeedbackRecipe, true);
});

test("virgülle yazılan çoklu ret notundan varyant kahve reçetesi üretir", async () => {
  const { service, saved } = fixture({
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    rejectedFeedbackHints: async () => [
      {
        barcode: "528528268",
        reason:
          "DOĞRU: Harras Değirmen Kapak Tane Karabiber 50g - 109₺ ve Harras Tane Karabiber 100g - 97,5₺",
        created_at: "2026-07-15T10:00:00.000Z",
      },
      {
        barcode: "528528268",
        reason:
          "DOĞRU: Harras Guatemala Filtre Kahve 250g - 229₺, Harras Colombia Filtre Kahve 250g - 229₺, Harras Colombia Medium Roast Filtre Kahve 250g - 229₺, Harras Special Blend Filtre Kahve 250g - 199₺",
        created_at: "2026-07-15T11:00:00.000Z",
      },
    ],
    targetProducts: async () => [
      {
        barcode: "528528268",
        product_name: "Harras Filtre Kahve 4'lü Deneme Seti",
        brand: "Harras",
        category_id: "900",
        data_status: "MAPPING_MISSING",
        is_active: true,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 61,
        product_name: "Harras Guatemala Filtre Kahve 250 g",
        brand: "Harras",
        current_price: 229,
      },
      {
        id: 65,
        product_name: "Harras Guatemala Filtre Kahve 250 g",
        brand: "Harras",
        current_price: 229,
      },
      {
        id: 62,
        product_name: "Harras Colombia Filtre Kahve 250 g",
        brand: "Harras",
        current_price: 229,
      },
      {
        id: 63,
        product_name: "Harras Colombia Medium Roast Filtre Kahve 250 g",
        brand: "Harras",
        current_price: 229,
      },
      {
        id: 64,
        product_name: "Harras Special Blend Filtre Kahve 250 g",
        brand: "Harras",
        current_price: 199,
      },
      {
        id: 71,
        product_name: "Harras Değirmen Kapak Tane Karabiber 50g",
        brand: "Harras",
        current_price: 109,
      },
      {
        id: 72,
        product_name: "Harras Tane Karabiber 100 g",
        brand: "Harras",
        current_price: 97.5,
      },
      {
        id: 561,
        product_name: "Harras Pratik Filtre Kahve Tekli",
        brand: "Harras",
        current_price: 11.5,
      },
      {
        id: 377,
        product_name: "Harras Pratik Filtre Kahve Tekli",
        brand: "Harras",
        current_price: 11.5,
      },
    ],
  });

  await service.generate({ limit: 100 });

  assert.equal(saved[0].source_type, "FEEDBACK_EXPLICIT_FILE_RECIPE");
  assert.equal(saved[0].items.length, 4);
  assert.deepEqual(
    saved[0].items.map((item) => item.file_market_item_id).sort(),
    [61, 62, 63, 64],
  );
  assert.ok(
    saved[0].items.every(
      (item) => !item.file_product_name.toLowerCase().includes("karabiber"),
    ),
  );
  assert.ok(
    saved[0].items.every(
      (item) => !item.file_product_name.toLowerCase().includes("pratik"),
    ),
  );
  assert.deepEqual(
    saved[0].items
      .map((item) => item.suggested_unit_cost)
      .sort((a, b) => a - b),
    [199, 229, 229, 229],
  );
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
  service.repository.rejectedSourceBarcodes = async () => [
    `${rejectedSuggestion.barcode}:${rejectedSuggestion.source_barcode}`,
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

test("Hepsiburada mapping marka eksik olsa da isim benzerligiyle dusuk guvenli aday uretir", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        barcode: "HB-KAKAO",
        product_name: "Ülker Toz Kakao 150 Gr",
        brand: "",
        category_id: "",
        data_status: "MAPPING_MISSING",
        is_active: true,
        marketplace: "HEPSIBURADA",
      },
    ],
    trainingRows: async () => [],
    fileItemsForMatching: async () => [
      {
        id: 901,
        product_name: "Ülker Toz Kakao 150 g",
        brand: "Ülker",
        current_price: 89,
        supplier_code: "BIZIM_MARKET",
        estimated_unit_desi: 1,
      },
    ],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 1);
  assert.equal(saved[0].marketplace, "HEPSIBURADA");
  assert.equal(saved[0].supplier_code, "BIZIM_MARKET");
  assert.notEqual(saved[0].confidence_band, "HIGH");
});

test("uzun Hepsiburada basligi kisa tedarikci adini ve genel marka alanini kacirmaz", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        barcode: "HB-KURABIYE-3",
        product_name:
          "Harras Tereyağlı Kurabiye 180 gr x 3 Adet Avantajlı Aile Paketi",
        brand: "Harras",
        category_id: "",
        data_status: "MAPPING_MISSING",
        is_active: true,
        marketplace: "HEPSIBURADA",
      },
    ],
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    fileItemsForMatching: async () => [
      {
        id: 902,
        product_name: "Harras Tereyağlı Kurabiye 180 g",
        brand: "DİĞER MARKALAR",
        current_price: 229,
        supplier_code: "FILE_MARKET",
        estimated_unit_desi: 1,
      },
    ],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.supplierScoped, 1);
  assert.equal(result.created, 1);
  assert.equal(saved[0].items[0].file_market_item_id, 902);
  assert.equal(saved[0].items[0].quantity, 3);
});

test("Hepsiburada magazasi markasi tedarikci markasindan farkli olsa da guvenli eslesmeyi incelemeye cikarir", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        barcode: "HB-PRIVATE-BRAND",
        product_name: "Tereyağlı Kurabiye 180 gr x 3 Adet",
        brand: "Aşlamacı Bakliyat",
        data_status: "MAPPING_MISSING",
        is_active: true,
        marketplace: "HEPSIBURADA",
      },
    ],
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    fileItemsForMatching: async () => [
      {
        id: 904,
        product_name: "Harras Tereyağlı Kurabiye 180 g",
        brand: "Harras",
        current_price: 229,
        supplier_code: "FILE_MARKET",
        estimated_unit_desi: 1,
      },
    ],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.supplierScoped, 1);
  assert.equal(result.created, 1);
  assert.equal(saved[0].confidence_band, "LOW");
  assert.equal(saved[0].evidence.crossMarketplaceBrandMismatch, true);
  assert.equal(saved[0].items[0].quantity, 3);
});

test("Hepsiburada magazasi markasi farkli olsa da Trendyol recetesini dusuk guvenle kullanir", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        barcode: "HB-PRIVATE-RECIPE",
        product_name: "Menekşe Konsantre Yumuşatıcı 1500 ml x 2",
        brand: "Aşlamacı Bakliyat",
        data_status: "MAPPING_MISSING",
        is_active: true,
        marketplace: "HEPSIBURADA",
      },
    ],
    trainingRows: async () => [
      {
        marketplace: "TRENDYOL",
        barcode: "TY-MENEKSE-2",
        product_name: "Actisoft Menekşe Yumuşatıcı 1,5 L x 2",
        brand: "Actisoft",
        cost_item_code: "ACTISOFT_MENEKSHE_1500ML",
        item_name: "Actisoft Menekşe Yumuşatıcı 1500 ml",
        quantity: 2,
        unit_cost: 112,
        unit_desi: 1.5,
      },
    ],
    fileItemsForMatching: async () => [],
    costItemsForMatching: async () => [],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.recipeScoped, 1);
  assert.equal(result.created, 1);
  assert.equal(saved[0].source_type, "MANUAL_HISTORY");
  assert.equal(saved[0].confidence_band, "LOW");
  assert.equal(saved[0].evidence.crossMarketplaceBrandMismatch, true);
});

test("Hepsiburada marka farkini gevsetirken urun turu ve kelime ilgisi olmayan adaylari engeller", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        barcode: "HB-TISSUE",
        product_name: "Daycare Kutu Mendil 2'li",
        brand: "Aşlamacı Bakliyat",
        data_status: "MAPPING_MISSING",
        is_active: true,
        marketplace: "HEPSIBURADA",
      },
    ],
    trainingRows: async () => [],
    costItemsForMatching: async () => [
      {
        item_code: "RENAX_BULASIK_MAKINESI_TUZU",
        item_name: "Renax Bulaşık Makinesi Tuzu",
        unit_cost: 60,
        unit_desi: 2,
      },
    ],
    fileItemsForMatching: async () => [
      {
        id: 905,
        product_name: "Karışık Renkli Kadın Şal",
        brand: "Diğer Markalar",
        current_price: 75,
        supplier_code: "BIZIM_MARKET",
      },
    ],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 0);
  assert.equal(saved.length, 0);
});

test("tedarikci adinda farkli hassas varyanti yalniz genel kelimelerle onermez", async () => {
  const { service, saved } = fixture({
    targetProducts: async () => [
      {
        barcode: "HB-MENEKSE",
        product_name: "Actisoft Menekşe Konsantre Yumuşatıcı 1500 ml 2 Adet",
        brand: "Actisoft",
        data_status: "MAPPING_MISSING",
        is_active: true,
        marketplace: "HEPSIBURADA",
      },
    ],
    trainingRows: async () => [],
    costItemsForMatching: async () => [],
    fileItemsForMatching: async () => [
      {
        id: 903,
        product_name: "Actisoft Çiçek Rüyası Konsantre Yumuşatıcı 1500 ml",
        brand: "DİĞER MARKALAR",
        current_price: 112,
        supplier_code: "FILE_MARKET",
        estimated_unit_desi: 1.5,
      },
    ],
  });

  const result = await service.generate({
    limit: 100,
    marketplace: "HEPSIBURADA",
  });

  assert.equal(result.created, 0);
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
