const test = require("node:test");
const assert = require("node:assert/strict");
const { RepricerService } = require("../../src/services/repricer.service");

function row(overrides = {}) {
  return {
    marketplace: "TRENDYOL",
    barcode: "TEST-1",
    product_name: "Test Ürün",
    is_active: true,
    on_sale: true,
    locked: false,
    stock_quantity: 10,
    data_complete: true,
    commission_rate: 17,
    calculated_net_profit: 100,
    calculated_product_cost: 100,
    calculated_shipping_cost: 20,
    packaging_cost: 10,
    service_fee: 5,
    min_price: 300,
    my_price: 500,
    buybox_price: 480,
    second_price: 510,
    third_price: 520,
    rank: 2,
    buybox_updated_at: new Date().toISOString(),
    strategy: "Normal",
    price_cut_tl: 0.1,
    max_increase_tl: 10,
    max_single_change_pct: 15,
    max_daily_change_pct: 15,
    min_undercut_tl: 0.1,
    max_undercut_tl: 75,
    min_change_interval_minutes: 0,
    daily_action_limit: 3,
    buybox_max_age_minutes: 20,
    setting_auto_update: true,
    unlimited_increase: false,
    ...overrides,
  };
}

function createService({ initial, afterRefresh, failRefresh = false }) {
  let current = initial;
  const refreshCalls = [];
  const service = new RepricerService({
    db: {
      query: async () => ({ rows: [current] }),
    },
    actions: {
      todayStats: async () => ({ action_count: 0, day_start_price: 500 }),
    },
    settings: {
      getAll: async () => ({
        global_dry_run: false,
        global_repricer_enabled: true,
        global_max_price_change_pct: 15,
        global_unlimited_increase: false,
        buybox_max_age_minutes: 20,
        default_price_cut_tl: 0.1,
        default_max_increase_tl: 10,
        default_target_profit: 0,
      }),
    },
    sync: {
      buybox: async (barcodes) => {
        refreshCalls.push(barcodes);
        if (failRefresh)
          return {
            processed: 0,
            successful: 0,
            failed: barcodes.length,
            updatedBarcodes: [],
            failedBarcodes: barcodes,
          };
        current = afterRefresh;
        return {
          processed: barcodes.length,
          successful: barcodes.length,
          failed: 0,
          updatedBarcodes: barcodes,
          failedBarcodes: [],
        };
      },
    },
  });
  return { service, refreshCalls };
}

test("stale buybox aynı preview içinde yenilenip karar baştan hesaplanır", async () => {
  const { service, refreshCalls } = createService({
    initial: row({
      buybox_updated_at: new Date(Date.now() - 60 * 60000).toISOString(),
    }),
    afterRefresh: row({
      buybox_price: 490,
      buybox_updated_at: new Date().toISOString(),
    }),
  });
  const [preview] = await service.preview("TEST-1", "TRENDYOL");
  assert.deepEqual(refreshCalls, [["TEST-1"]]);
  assert.equal(preview.action, "FIYAT_DUSUR");
  assert.equal(preview.proposedPrice, 489.9);
  assert.ok(!preview.blockedReasons.includes("BUYBOX_STALE"));
});

test("fiyat buybox altında fakat sıra kötü ise önce veri yenilenir", async () => {
  const { service, refreshCalls } = createService({
    initial: row({
      my_price: 500,
      buybox_price: 520,
      rank: 2,
    }),
    afterRefresh: row({
      my_price: 500,
      buybox_price: 500,
      second_price: 560,
      rank: 1,
      buybox_updated_at: new Date().toISOString(),
    }),
  });
  const [preview] = await service.preview("TEST-1", "TRENDYOL");
  assert.deepEqual(refreshCalls, [["TEST-1"]]);
  assert.equal(preview.action, "FIYAT_ARTIR");
  assert.equal(preview.proposedPrice, 559);
});

test("buybox yenilenemezse fiyat değişikliği üretilmez", async () => {
  const { service } = createService({
    initial: row({
      buybox_updated_at: new Date(Date.now() - 60 * 60000).toISOString(),
    }),
    afterRefresh: null,
    failRefresh: true,
  });
  const [preview] = await service.preview("TEST-1", "TRENDYOL");
  assert.equal(preview.action, "KORU");
  assert.equal(preview.obstacle, "BUYBOX_STALE");
  assert.ok(preview.blockedReasons.includes("BUYBOX_STALE"));
});
