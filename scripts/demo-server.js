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
    reason: "Buybox korunuyor",
    created_at: now,
  },
];
const settingsItems = [
  { key: "global_dry_run", value: true },
  { key: "global_repricer_enabled", value: false },
  { key: "google_sheets_sync_enabled", value: true },
  { key: "default_target_profit", value: 40 },
  { key: "default_price_cut_tl", value: 0.1 },
  { key: "global_max_price_change_pct", value: 15 },
  { key: "default_carrier", value: "TEX" },
  { key: "service_fee", value: 13.19 },
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
            minimum_margin_pct: 0,
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
  history: async () => actionRows,
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
      stale_buybox: 3,
      auto_update_enabled: 7,
      average_margin: 17.8,
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
    jobs: [{ last_status: "SUCCESS" }, { last_status: "SUCCESS" }],
    lastError: null,
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
  saveCostItem: async (x) => x,
  upsertMapping: async (x) => x,
  saveCommission: async (x) => x,
  saveShippingRate: async (x) => x,
  saveBarem: async (x) => x,
  savePackaging: async (x) => x,
  validateMappings: async () => ({ valid: true, errors: [] }),
  replaceMappings: async (rows) => ({ replaced: rows.length }),
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
  "sheets-import",
  "sheets-export",
].map((name, i) => ({
  id: i + 1,
  name,
  description: "Otomatik operasyon görevi",
  schedule_minutes: i === 1 ? 10 : 60,
  last_status: "SUCCESS",
  last_started_at: now,
  last_duration_ms: 420 + i * 30,
  last_processed_count: i === 1 ? 7 : 755,
}));
const container = {
  auth,
  db: { query: async () => ({ rows: [{}] }) },
  audit: {
    record: async () => {},
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
  sheets: {
    health: () => ({ configured: true, circuitOpen: false }),
    metadata: async () => ({ properties: { title: "Aşlamacı ERP" } }),
  },
  trendyol: { configured: () => true },
  dashboard,
  products: productRepo,
  costEngine: { recalculate: async () => ({ processed: 1 }) },
  costs,
  repricer,
  actions: {
    list: async () => actionRows,
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
          paused: false,
        })),
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
  },
  jobs: { list: async () => jobItems, runs: async () => [] },
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
};
createApp(container).listen(Number(process.env.PORT), () =>
  console.log(
    `Demo server: http://localhost:${process.env.PORT} (admin / demo12345678)`,
  ),
);
