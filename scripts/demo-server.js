process.env.NODE_ENV = "development";
process.env.PORT = process.env.PORT || "4173";
const { createApp } = require("../src/app");
const { AuthService, hashPassword } = require("../src/services/auth.service");
const now = new Date().toISOString();
const products = [
  {
    id: 1,
    marketplace: "TRENDYOL",
    barcode: "8690609598109",
    product_name: "Menekşe Konsantre Çamaşır Yumuşatıcısı 1500 ml",
    brand: "Actisoft",
    category_name: "Yumuşatıcı",
    category_id: "2354",
    stock_quantity: 2000,
    is_active: true,
    on_sale: true,
    locked: false,
    my_price: 329.9,
    commission_rate: 17,
    desi: 1.5,
    calculated_product_cost: 112,
    calculated_shipping_cost: 79,
    packaging_cost: 15,
    service_fee: 13.19,
    target_profit: 40,
    calculated_total_cost: 259.19,
    min_price: 312.28,
    calculated_net_profit: 44.63,
    calculated_net_margin: 13.53,
    buybox_price: 329.9,
    second_price: 334.9,
    third_price: 339.9,
    rank: 1,
    data_complete: true,
    data_status: "COMPLETE",
    auto_update: false,
    repricer_mode: "MANUAL",
    strategy: "Manuel",
    learned_price_cut_tl: 0,
    buybox_updated_at: now,
    updated_at: now,
  },
  {
    id: 2,
    marketplace: "TRENDYOL",
    barcode: "8695077036402",
    product_name: "Hipoalerjenik Çiçek Rüyası Yumuşatıcı 1500 ml X 4",
    brand: "Actisoft",
    category_name: "Yumuşatıcı",
    category_id: "2354",
    stock_quantity: 2000,
    is_active: true,
    on_sale: true,
    locked: false,
    my_price: 944,
    commission_rate: 17,
    desi: 6,
    calculated_product_cost: 448,
    calculated_shipping_cost: 141.96,
    packaging_cost: 25,
    service_fee: 13.19,
    target_profit: 40,
    calculated_total_cost: 668.15,
    min_price: 805,
    calculated_net_profit: 155.37,
    calculated_net_margin: 16.46,
    buybox_price: 950,
    second_price: 949,
    third_price: 960,
    rank: 2,
    data_complete: true,
    data_status: "COMPLETE",
    auto_update: true,
    repricer_mode: "AUTOMATIC",
    strategy: "Öğrenen Pilot",
    learned_price_cut_tl: 11,
    buybox_updated_at: now,
    updated_at: now,
  },
  {
    id: 3,
    marketplace: "TRENDYOL",
    barcode: "8695077036404",
    product_name: "Hipoalerjenik Sensitive Yumuşatıcı 1500 ml X 4",
    brand: "Actisoft",
    category_name: "Yumuşatıcı",
    category_id: "2354",
    stock_quantity: 2000,
    is_active: true,
    on_sale: true,
    locked: false,
    my_price: 973,
    commission_rate: 17,
    desi: 6,
    calculated_product_cost: 448,
    calculated_shipping_cost: 141.96,
    packaging_cost: 25,
    service_fee: 13.19,
    target_profit: 40,
    calculated_total_cost: 668.15,
    min_price: 805,
    calculated_net_profit: 179.44,
    calculated_net_margin: 18.44,
    buybox_price: 973,
    second_price: 979,
    third_price: 989,
    rank: 1,
    data_complete: true,
    data_status: "COMPLETE",
    auto_update: true,
    repricer_mode: "AUTOMATIC",
    strategy: "Öğrenen Pilot",
    learned_price_cut_tl: 6,
    buybox_updated_at: now,
    updated_at: now,
  },
  {
    id: 4,
    marketplace: "TRENDYOL",
    barcode: "86952556586",
    product_name: "Vücut Sir Ağda Bandı 20'li X 4",
    brand: "Daycare",
    category_name: "Ağda Bandı",
    category_id: "4604",
    stock_quantity: 2000,
    is_active: true,
    on_sale: true,
    my_price: 909.99,
    commission_rate: null,
    desi: 0,
    calculated_product_cost: 0,
    calculated_shipping_cost: 0,
    packaging_cost: 0,
    service_fee: 13.19,
    min_price: 0,
    calculated_net_profit: 0,
    calculated_net_margin: 0,
    buybox_price: 899,
    rank: 3,
    data_complete: false,
    data_status: "MAPPING_MISSING",
    auto_update: false,
    repricer_mode: "MANUAL",
    buybox_updated_at: now,
    updated_at: now,
  },
  {
    id: 5,
    marketplace: "TRENDYOL",
    barcode: "8691111111111",
    product_name: "Obaçay Rize 1 Kg X 2",
    brand: "Obaçay",
    category_name: "Dökme Çay",
    category_id: "2895",
    stock_quantity: 400,
    is_active: true,
    on_sale: true,
    my_price: 589,
    commission_rate: 13,
    desi: 2,
    calculated_product_cost: 448,
    calculated_shipping_cost: 93.05,
    packaging_cost: 15,
    service_fee: 13.19,
    target_profit: 40,
    min_price: 700,
    calculated_net_profit: -63.81,
    calculated_net_margin: -10.83,
    buybox_price: 585,
    rank: 4,
    data_complete: true,
    data_status: "COMPLETE",
    auto_update: false,
    repricer_mode: "MONITOR",
    buybox_updated_at: now,
    updated_at: now,
  },
];
const actionRows = [
  {
    id: 1,
    barcode: "8695077036402",
    product_name: products[1].product_name,
    action: "FIYAT_DUSUR",
    old_price: 944,
    proposed_price: 939,
    min_price: 805,
    status: "PENDING",
    source: "WEB",
    target_rank: 1,
    reason: "Buybox fiyatının altına kontrollü iniş",
    created_at: now,
  },
  {
    id: 2,
    barcode: "8695077036404",
    product_name: products[2].product_name,
    action: "KORU",
    old_price: 973,
    proposed_price: 973,
    min_price: 805,
    status: "SUCCESS",
    source: "AUTO",
    applied_price: 973,
    target_rank: 1,
    rank_after: 1,
    reason: "Buybox korunuyor",
    created_at: now,
  },
];
const settingsItems = [
  { key: "global_dry_run", value: true },
  { key: "global_repricer_enabled", value: false },
  { key: "default_target_profit", value: 40 },
  { key: "default_price_cut_tl", value: 0.1 },
  { key: "default_max_increase_tl", value: 10 },
  { key: "global_max_price_change_pct", value: 15 },
  { key: "buybox_max_age_minutes", value: 20 },
  { key: "product_sync_cron_minutes", value: 360 },
  { key: "buybox_sync_cron_minutes", value: 10 },
  { key: "cost_calculation_cron_minutes", value: 30 },
  { key: "repricer_cron_minutes", value: 10 },
  { key: "log_retention_days", value: 90 },
  { key: "default_carrier", value: "TEX" },
  { key: "service_fee", value: 13.19 },
  { key: "default_carrier_trendyol", value: "TEX" },
  { key: "service_fee_trendyol", value: 13.19 },
  { key: "default_carrier_hepsiburada", value: "hepsiJET" },
  { key: "service_fee_hepsiburada", value: 10.5 },
];
const fileMarketItems = [
  {
    id: 1,
    source_key: "actisoft-menekse-1500",
    product_name: "Actisoft Menekşe Bahçesi Konsantre 1500 ml",
    normalized_name: "actisoft menekse bahcesi konsantre 1500 ml",
    brand: "Actisoft",
    size_value: 1500,
    size_unit: "ml",
    current_price: 112,
    previous_price: 109.9,
    availability: "AVAILABLE",
    last_seen_at: now,
    stale: false,
    supplier_code: "FILE_MARKET",
  },
];
const supplierPricePools = {
  FILE_MARKET: fileMarketItems,
  BIZIM_MARKET: [
    {
      id: 2,
      source_key: "bizim-web:13856",
      product_name: "Ülker Çikolatalı Gofret 36 g 36'lı",
      brand: "Ülker",
      current_price: 475.21,
      availability: "AVAILABLE",
      estimated_unit_desi: 1.296,
      desi_confidence: "HIGH",
      source_category: "Atıştırmalık",
      last_seen_at: now,
      supplier_code: "BIZIM_MARKET",
    },
  ],
  BIM: [
    {
      id: 3,
      source_key: "bim-yemeksepeti:demo",
      product_name: "BİM Test Ürünü 250 g",
      brand: "BİM",
      current_price: 49.9,
      availability: "AVAILABLE",
      estimated_unit_desi: 0.25,
      desi_confidence: "HIGH",
      source_category: "Temel Gıda",
      last_seen_at: now,
      supplier_code: "BIM",
    },
  ],
};
const mappingSuggestions = [
  {
    id: 14,
    barcode: "86952556586",
    product_name: "Vücut Sir Ağda Bandı 20'li X 4",
    category_name: "Ağda Bandı",
    confidence: 0.94,
    confidence_band: "HIGH",
    status: "PENDING",
    source_type: "MANUAL_HISTORY_AND_FILE",
    source_barcode: "86952556585",
    update_file_price: true,
    file_market_item_id: 1,
    file_product_name: "Daycare Sir Ağda Bandı 20'li",
    file_current_price: 119.9,
    file_last_seen_at: now,
    algorithm_version: "manual-history-file-v1",
    fingerprint: "demo-suggestion",
    updated_at: now,
    evidence: {
      sourceProductName: "Daycare Vücut Sir Ağda Bandı 20'li X 2",
      reasons: [
        { code: "NAME_SIMILARITY", value: 0.96 },
        { code: "BRAND_MATCH", value: 1 },
        { code: "SIZE_MATCH", value: 1 },
      ],
    },
    items: [
      {
        id: 31,
        cost_item_code: "DAYCARE_AGDA_BANDI_20LI",
        item_name: "Daycare Sir Ağda Bandı 20'li",
        quantity: 4,
        current_unit_cost: 117.5,
        unit_cost: 117.5,
        suggested_unit_cost: 119.9,
        unit_desi: 0.25,
        file_market_item_id: 1,
        file_product_name: "Daycare Sir Ağda Bandı 20'li",
        file_current_price: 119.9,
        file_last_seen_at: now,
      },
    ],
  },
];
const auth = new AuthService({
  username: "admin",
  passwordHash: hashPassword("demo12345678"),
  secret: "demo-session-secret".repeat(3),
});
const productRepo = {
  list: async (filters) => {
    let rows = [...products];
    if (filters.search)
      rows = rows.filter((x) =>
        JSON.stringify(x).toLowerCase().includes(filters.search.toLowerCase()),
      );
    return {
      items: rows,
      total: rows.length,
      page: Number(filters.page) || 1,
      limit: Number(filters.limit) || 50,
    };
  },
  get: async (barcode) => {
    const p = products.find((x) => x.barcode === barcode);
    return p
      ? {
          ...p,
          settings: {
            strategy: p.strategy || "Manuel",
            mode: p.repricer_mode,
            auto_update: p.auto_update,
            price_cut_tl: 0.1,
            max_increase_tl: 10,
            max_daily_change_pct: 15,
            minimum_profit_tl: 40,
            minimum_profit_pct: 0,
            minimum_margin_pct: 0,
            min_undercut_tl: 0.1,
            max_undercut_tl: 75,
            min_change_interval_minutes: 30,
            daily_action_limit: 3,
            buybox_max_age_minutes: 20,
            learning_enabled: true,
          },
          learning: { learned_price_cut_tl: p.learned_price_cut_tl },
        }
      : null;
  },
  breakdown: async (barcode) => {
    const p = products.find((x) => x.barcode === barcode);
    return {
      product: p,
      mappings: p?.calculated_product_cost
        ? [
            {
              id: 1,
              cost_item_code: "YUMUSATICI_ACTISOFT_1500ML",
              item_name: "Actisoft Yumuşatıcı 1500 ml",
              quantity: barcode === "8690609598109" ? 1 : 4,
              unit_cost: 112,
              line_cost: p.calculated_product_cost,
              orphan: false,
            },
          ]
        : [],
    };
  },
  history: async (barcode, type) => {
    if (type === "price")
      return [
        {
          id: 1,
          barcode,
          old_price: 930,
          new_price: 944,
          buybox_price: 950,
          action: "FIYAT ARTIR",
          created_at: now,
        },
      ];
    if (type === "buybox")
      return [
        {
          id: 1,
          barcode,
          observed_price: 944,
          buybox_price: 950,
          second_price: 949,
          third_price: 960,
          rank: 2,
          observed_at: now,
        },
      ];
    return actionRows;
  },
  updateSettings: async (barcode, input) => input,
};
const dashboard = {
  get: async () => ({
    kpis: {
      total_products: 755,
      active_products: 709,
      stocked_products: 708,
      complete_products: 304,
      missing_mapping: 451,
      missing_commission: 399,
      loss_products: 12,
      buybox_owned: 1,
      buybox_available: 4,
      stale_buybox: 3,
      auto_update_enabled: 7,
      average_margin: 17.8,
      actions_24h: 7,
      successful_actions_24h: 5,
      failed_actions_24h: 2,
    },
    charts: {
      categories: [
        { name: "Yumuşatıcı", count: 146, margin: 18.4 },
        { name: "Dökme Çay", count: 94, margin: 14.2 },
        { name: "Deterjan", count: 78, margin: 16.1 },
        { name: "Kişisel Bakım", count: 63, margin: 12.8 },
      ],
      actions: [
        { day: "08 Tem", count: 2, successful: 1 },
        { day: "09 Tem", count: 6, successful: 4 },
        { day: "10 Tem", count: 7, successful: 1 },
      ],
      buybox: [
        { day: "08 Tem", won: 1, lost: 0, target_achieved: 2 },
        { day: "09 Tem", won: 2, lost: 1, target_achieved: 4 },
      ],
    },
    topProfit: products.slice(0, 3).map((x) => ({
      barcode: x.barcode,
      product_name: x.product_name,
      value: x.calculated_net_profit,
      margin: x.calculated_net_margin,
    })),
    topRisk: [
      {
        ...products[4],
        value: products[4].calculated_net_profit,
        margin: products[4].calculated_net_margin,
        reason: "Minimum fiyat altı",
      },
    ],
    jobs: [
      {
        job_name: "sync-products",
        last_status: "SUCCESS",
        last_started_at: now,
      },
      { job_name: "sync-buybox", last_status: "SUCCESS", last_started_at: now },
    ],
    lastError: null,
    settings: {
      global_dry_run: true,
      global_repricer_enabled: false,
      maintenance_mode: false,
    },
  }),
};
const costs = {
  listCostItems: async () => [
    {
      id: 1,
      item_code: "YUMUSATICI_ACTISOFT_1500ML",
      item_name: "Actisoft Yumuşatıcı 1500 ml",
      unit_cost: 112,
      unit_desi: 1.5,
      unit: "adet",
      product_count: 9,
    },
    {
      id: 2,
      item_code: "OBACAY_RIZE_1KG",
      item_name: "Obaçay Rize 1 Kg",
      unit_cost: 224,
      unit_desi: 1,
      unit: "adet",
      product_count: 6,
    },
  ],
  costItemUsage: async () => [
    {
      barcode: products[0].barcode,
      product_name: products[0].product_name,
      quantity: 1,
      item_code: "YUMUSATICI_ACTISOFT_1500ML",
      line_cost: 112,
    },
  ],
  listMappings: async () => [
    {
      id: 1,
      barcode: products[0].barcode,
      product_name: products[0].product_name,
      cost_item_code: "YUMUSATICI_ACTISOFT_1500ML",
      item_name: "Actisoft Yumuşatıcı 1500 ml",
      quantity: 1,
      line_cost: 112,
      orphan: false,
    },
  ],
  listCommissions: async () => [
    {
      id: 1,
      category_id: "2354",
      category_name: "Yumuşatıcı",
      commission_rate: 17,
      product_count: 146,
    },
  ],
  missingCommissionCategories: async () => [
    {
      category_id: products[3].category_id,
      category_name: products[3].category_name,
      product_count: 1,
    },
  ],
  shipping: async () => ({
    rates: [
      {
        id: 1,
        carrier: "TEX",
        desi_kg: 2,
        cost_ex_vat: 77.54,
        cost_inc_vat: 93.05,
      },
    ],
    barems: [
      {
        id: 1,
        carrier: "TEX",
        barem_name: "BAREM2",
        min_basket: 200,
        max_basket: 349.99,
        cost_ex_vat: 65.83,
        cost_inc_vat: 79,
      },
    ],
    packaging: [{ id: 1, min_desi: 1, max_desi: 3, packaging_cost: 15 }],
  }),
  shippingPage: async ({ marketplace, page, limit }) => {
    const hepsiburada = marketplace === "HEPSIBURADA";
    return {
      marketplace,
      rates: hepsiburada
        ? [
            {
              id: 2,
              marketplace,
              carrier: "Aras",
              desi_kg: 0,
              cost_ex_vat: 90,
              cost_inc_vat: 108,
            },
          ]
        : [
            {
              id: 1,
              marketplace,
              carrier: "TEX",
              desi_kg: 2,
              cost_ex_vat: 77.54,
              cost_inc_vat: 93.05,
            },
          ],
      barems: hepsiburada
        ? [
            {
              id: 2,
              marketplace,
              carrier: "hepsiJET",
              barem_name: "BAREM",
              min_basket: 0,
              max_basket: 199.99,
              cost_ex_vat: 42,
              cost_inc_vat: 50.4,
            },
            {
              id: 3,
              marketplace,
              carrier: "hepsiJET",
              barem_name: "BAREM2",
              min_basket: 200,
              max_basket: 399.99,
              cost_ex_vat: 72,
              cost_inc_vat: 86.4,
            },
          ]
        : [
            {
              id: 1,
              carrier: "TEX",
              barem_name: "BAREM2",
              min_basket: 200,
              max_basket: 349.99,
              cost_ex_vat: 65.83,
              cost_inc_vat: 79,
            },
          ],
      packaging: hepsiburada
        ? [
            {
              id: 2,
              marketplace,
              min_desi: 1,
              max_desi: 3,
              packaging_cost: 15,
              note: "Hepsiburada standart paket",
            },
          ]
        : [{ id: 1, min_desi: 1, max_desi: 3, packaging_cost: 15 }],
      carriers: hepsiburada ? ["hepsiJET", "Aras"] : ["TEX"],
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: hepsiburada ? 49511 : 501,
      },
    };
  },
  saveCostItem: async (x) => x,
  saveCostItems: async (rows) => ({ processed: rows.length, items: rows }),
  upsertMapping: async (x) => x,
  updateMapping: async (id, x) => ({ id, ...x }),
  saveCommission: async (x) => x,
  saveCommissions: async (rows) => ({ updated: rows.length }),
  saveShippingRate: async (x) => x,
  saveBarem: async (x) => x,
  savePackaging: async (x) => x,
  validateMappings: async () => ({ valid: true, errors: [] }),
  previewMappings: async (rows) => ({
    valid: true,
    errors: [],
    rows,
    products: [...new Set(rows.map((row) => row.barcode))].map((barcode) => ({
      barcode,
      mapping_count: rows.filter((row) => row.barcode === barcode).length,
      product_cost: 112,
      desi: 1.5,
    })),
  }),
  replaceMappingsForBarcodes: async (rows) => ({
    replacedBarcodes: new Set(rows.map((row) => row.barcode)).size,
    insertedMappings: rows.length,
    barcodes: [...new Set(rows.map((row) => row.barcode))],
  }),
  cloneMappings: async (source, targets) => ({
    source,
    replacedBarcodes: targets.length,
    insertedMappings: targets.length,
    barcodes: targets,
  }),
  replaceMappings: async (rows) => ({ replaced: rows.length }),
  deleteCostItem: async () => ({}),
  deleteMapping: async () => ({}),
  deleteShippingRate: async () => ({}),
  deleteBarem: async () => ({}),
  deletePackaging: async () => ({}),
};
const repricer = {
  globalSettings: async () => ({ dryRun: true, repricerEnabled: false }),
  preview: async (barcode) =>
    products
      .filter((x) => x.auto_update && (!barcode || x.barcode === barcode))
      .map((x) => ({
        barcode: x.barcode,
        productName: x.product_name,
        action: x.rank === 1 ? "FIYAT_ARTIR" : "FIYAT_DUSUR",
        oldPrice: x.my_price,
        proposedPrice: x.rank === 1 ? 978 : 939,
        difference: x.rank === 1 ? 5 : -5,
        expectedProfit: x.calculated_net_profit,
        rank: x.rank,
        targetRank: x.rank === 1 ? 1 : 1,
        effectiveUndercut: x.learned_price_cut_tl,
        reason:
          x.rank === 1
            ? "Buybox korunarak ikinci fiyatın altına çıkış"
            : "Buybox fiyatının altına kontrollü iniş",
        blockedReasons: ["DRY_RUN", "GLOBAL_REPRICER_DISABLED"],
      })),
  generate: async () => ({
    processed: 2,
    created: 1,
    items: actionRows.slice(0, 1),
  }),
};
repricer.manualAction = async (barcode, price) => ({
  id: 3,
  barcode,
  proposed_price: price,
  status: "PENDING",
});
const jobItems = [
  "sync-products",
  "sync-buybox",
  "calculate-costs",
  "generate-repricer-actions",
  "run-auto-repricer",
  "check-action-outcomes-5m",
  "generate-mapping-suggestions",
].map((name, i) => ({
  id: i + 1,
  name,
  description: "Otomatik operasyon görevi",
  schedule_minutes: i === 1 ? 10 : 60,
  last_status: "SUCCESS",
  last_started_at: now,
  last_duration_ms: 420 + i * 30,
  last_processed_count: i === 1 ? 7 : 755,
  enabled: true,
}));
const financeReport = {
  period: new Date().toISOString().slice(0, 7),
  marketplace: "TRENDYOL",
  summary: {
    order_count: 42,
    revenue: 28650,
    commission: 4610.75,
    shipping: 3920.4,
    service_fee: 553.98,
    product_cost: 12480,
    operational_profit: 7084.87,
    packaging: 850,
    profit_before_packaging: 7084.87,
    profit_after_packaging: 6234.87,
    operational_margin: 21.76,
    financed_by_bekir: 13330,
    transfer_to_bekir: 19564.87,
  },
  charts: {
    daily: [
      { day: "2026-07-18", orders: 12, revenue: 7850, profit: 1680 },
      { day: "2026-07-19", orders: 14, revenue: 9200, profit: 2110 },
      { day: "2026-07-20", orders: 16, revenue: 11600, profit: 2490 },
    ],
    hourly: [
      { hour: 10, orders: 4, revenue: 1850 },
      { hour: 14, orders: 12, revenue: 7920 },
      { hour: 20, orders: 9, revenue: 6140 },
    ],
    cities: [
      { city: "İstanbul", orders: 17, revenue: 10800 },
      { city: "Ankara", orders: 9, revenue: 6100 },
      { city: "İzmir", orders: 6, revenue: 4050 },
    ],
  },
  products: [
    {
      barcode: "8690609598109",
      product_name: "Menekşe Konsantre",
      quantity: 18,
      revenue: 5940,
      contribution: 1830,
    },
  ],
  transactions: [],
  packaging: { amount: 850 },
  insights: [
    {
      tone: "warning",
      title: "Finansal mutabakat bekleniyor",
      text: "Settlement verisi gelince kesintiler ayrıca doğrulanacak.",
    },
  ],
  methodology: {
    transfer: "Ürün alış maliyeti + aylık ambalaj + operasyonel kâr",
    warning:
      "Pazaryeri kesintileri şirket ödemesinden zaten düşüldüğü için ikinci kez eklenmez.",
    vat: "Bu ekran operasyonel nakit mutabakatıdır.",
  },
};
const container = {
  auth,
  db: { query: async () => ({ rows: [{}] }) },
  audit: {
    record: async () => {},
    entityHistory: async () => [],
    list: async () => [
      {
        id: 1,
        type: "audit",
        level: "INFO",
        actor: "admin",
        action: "LOGIN_SUCCESS",
        entity_id: "",
        created_at: now,
      },
    ],
  },
  trendyol: { configured: () => true },
  dashboard,
  products: productRepo,
  costEngine: { recalculate: async () => ({ processed: 1 }) },
  costs,
  mappingAutomation: {
    listSupplierItems: async (supplierCode) => ({
      items: supplierPricePools[supplierCode] || [],
      total: (supplierPricePools[supplierCode] || []).length,
      page: 1,
      limit: 50,
    }),
    importSupplierItems: async (supplierCode, rows) => ({
      processed: rows.length,
      created: rows.length,
      changed: 0,
      items: rows.map((row, index) => ({
        id: index + 100,
        ...row,
        supplier_code: supplierCode,
      })),
    }),
    syncLiveSupplierItems: async (supplierCode) => ({
      processed: (supplierPricePools[supplierCode] || []).length,
      created: 0,
      changed: 0,
      metadata: { productsScanned: 1, supplierCode },
    }),
    listFileItems: async () => ({
      items: fileMarketItems,
      total: fileMarketItems.length,
      page: 1,
      limit: 50,
    }),
    importFileItems: async (rows) => ({
      processed: rows.length,
      created: rows.length,
      changed: 0,
      items: rows,
    }),
    generate: async () => ({
      processed: 1,
      eligible: 1,
      created: 1,
      trainingProductCount: 304,
      filePoolSize: fileMarketItems.length,
    }),
    listSuggestions: async () => ({
      items: mappingSuggestions,
      total: mappingSuggestions.length,
      page: 1,
      limit: 50,
    }),
    getSuggestion: async (id) =>
      mappingSuggestions.find((item) => item.id === Number(id)),
    approve: async (id) => {
      const item = mappingSuggestions.find((row) => row.id === Number(id));
      item.status = "APPROVED";
      return item;
    },
    reject: async (id, actor, input) => {
      const item = mappingSuggestions.find((row) => row.id === Number(id));
      item.status = "REJECTED";
      item.rejection_reason = input.reason;
      return item;
    },
    bulkPreview: async (ids) => ({
      token: "demo-preview-token",
      suggestions: mappingSuggestions.filter((item) => ids.includes(item.id)),
      productCount: ids.length,
      mappingCount: ids.length,
      priceUpdateCount: ids.length,
    }),
    bulkApply: async (ids) => ({ applied: ids.length, items: ids }),
  },
  shippingService: {
    preview: async ({ sale_price, desi, carrier }) => ({
      salePrice: sale_price,
      desi,
      carrier,
      roundedDesi: Math.ceil(desi),
      shippingSource: "BAREM",
      shippingCost: 79,
      packagingCost: 15,
      totalFulfillmentCost: 94,
      warnings: [],
    }),
    coverage: async () => ({
      carriers: [{ carrier: "TEX", maximumDesi: 2, missingDesi: [1] }],
      packagingRuleCount: 1,
      warnings: [{ code: "MISSING_DESI_RATE", carrier: "TEX", desi: 1 }],
    }),
  },
  repricer,
  actions: {
    list: async () => actionRows,
    count: async () => actionRows.length,
    get: async (id) => actionRows.find((x) => x.id == id),
    learningList: async () =>
      products
        .filter((x) => x.learned_price_cut_tl)
        .map((x) => ({
          barcode: x.barcode,
          product_name: x.product_name,
          learned_price_cut_tl: x.learned_price_cut_tl,
          failed_attempts: 2,
          success_attempts: x.rank === 1 ? 1 : 0,
          consecutive_failures: x.rank === 1 ? 0 : 2,
          confidence_score: 0.4,
          strategy: "Öğrenen Pilot",
          learned_max_increase_tl: 5,
          last_outcome: x.rank === 1 ? "BUYBOX_KEPT" : "TARGET_RANK_MISSED",
          paused: false,
        })),
    learningDetail: async (barcode) => {
      const learning = (await container.actions.learningList()).find(
        (item) => item.barcode === barcode,
      );
      return {
        learning,
        nextRecommendation:
          "Öğrenilmiş fiyat adımını güvenlik sınırları içinde manuel onayla.",
        attempts: actionRows
          .filter((item) => item.barcode === barcode)
          .map((item) => ({
            ...item,
            attempted_undercut: Math.max(
              Number(item.buybox_before || item.old_price) -
                Number(item.applied_price || item.proposed_price),
              0,
            ),
            result: item.status === "SUCCESS" ? "BUYBOX_KEPT" : null,
            elapsed_minutes: item.status === "SUCCESS" ? 60 : null,
          })),
      };
    },
    updateLearning: async () => ({}),
  },
  actionService: {
    approve: async (id) => {
      const x = actionRows.find((a) => a.id == id);
      x.status = "APPROVED";
      return x;
    },
    reject: async (id) => {
      const x = actionRows.find((a) => a.id == id);
      x.status = "REJECTED";
      return x;
    },
    apply: async (id) => {
      const x = actionRows.find((a) => a.id == id);
      x.status = "DRY_RUN";
      return x;
    },
    editAndApprove: async (id, input) => {
      const x = actionRows.find((a) => a.id == id);
      x.proposed_price = input.proposedPrice;
      x.reason = input.reason || x.reason;
      x.status = "APPROVED";
      x.source = "MANUAL_EDIT";
      return x;
    },
    approveMany: async (ids) =>
      actionRows
        .filter((row) => ids.includes(row.id))
        .map((row) => ({ ...row, status: "APPROVED" })),
    requestRevert: async (id) => {
      const original = actionRows.find((row) => row.id == id);
      const reversal = {
        ...original,
        id: actionRows.length + 1,
        old_price: original.applied_price,
        proposed_price: original.old_price,
        status: "PENDING",
        source: "ROLLBACK",
        reverts_action_id: original.id,
        reason: `#${original.id} fiyat aksiyonunu güvenli geri alma`,
      };
      actionRows.unshift(reversal);
      return reversal;
    },
  },
  jobs: {
    list: async () => jobItems,
    runs: async () => [],
    update: async (name, input) => ({ name, ...input }),
  },
  jobService: {
    run: async (name) => ({
      job_name: name,
      status: "SUCCESS",
      processed_count: 7,
    }),
  },
  settings: {
    list: async () => settingsItems,
    getAll: async () =>
      Object.fromEntries(settingsItems.map((x) => [x.key, x.value])),
    set: async (key, value) => ({ key, value }),
  },
  sync: {
    health: async () => ({ configured: true }),
    trendyol: { listProducts: async () => ({ content: [products[0]] }) },
  },
  learning: { checkOutcomes: async () => ({ processed: 1 }) },
  finance: {
    monthlyReport: async (_month, marketplace) => ({
      ...financeReport,
      marketplace,
    }),
    setPackagingExpense: async (month, amount) => ({ month, amount }),
  },
  health: {
    scan: async () => ({
      status: "PASS",
      summary: { pass: 5, warning: 0, fail: 0 },
      checks: [],
    }),
  },
  hepsiburada: {
    configured: () => false,
    health: async () => ({
      configured: false,
      connected: false,
      message: "Demo ortamında kapalı",
    }),
  },
};
createApp(container).listen(Number(process.env.PORT), () =>
  console.log(
    `Demo server: http://localhost:${process.env.PORT} (admin / demo12345678)`,
  ),
);
