const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HepsiburadaFloorRecoveryService,
} = require("../../src/services/hepsiburada-floor-recovery.service");
const { proposePrice, safetyCheck } = require("../../src/domain/repricer");
test("existing tier cent rounding rejects a mismatched persisted fractional unit price", async () => {
  const f = fixture();
  f.row.price_source = "BIZIM_MARKET";
  f.offer.supplier_code = "BIZIM_MARKET";
  f.offer.raw_data = {
    price_tiers_verified: true,
    price_tiers_source: "BIZIM_PRODUCT_DETAIL",
    price_tiers_verified_at: new Date(f.now).toISOString(),
  };
  f.offer.price_tiers = [{ min_quantity: 3, unit_price: 0.335 }];
  f.offer.current_price = 1;
  f.row.canonical_unit_cost = 1;
  f.row.quantity = 3;
  f.row.effective_unit_cost = 0.335;
  f.row.unit_desi = 0.3333;
  f.product.calculated_product_cost = 1.01;
  const result = await f.service.evaluate(f.input());
  assert.equal(result.safety.safe, false);
  assert.ok(result.safety.failures.includes("HB_FLOOR_TIER_MISMATCH"));
  assert.equal(f.gets(), 0);
});
test("SKU fee below the configured platform fee blocks instead of understating expenses", async () => {
  const f = fixture();
  f.batch.minimumServiceFee = 10.5;
  f.product.service_fee = 5;
  assert.ok(
    (await f.service.evaluate(f.input())).safety.failures.includes(
      "HB_FLOOR_EXPENSE_UNVERIFIED",
    ),
  );
  assert.equal(f.gets(), 0);
});
function fixture() {
  const now = Date.now();
  let gets = 0;
  const settings = {
    strategy: "Agresif",
    mode: "AUTOMATIC",
    auto_update: true,
    unlimited_increase: true,
    minimum_profit_tl: 50,
    daily_action_limit: 10000,
    min_change_interval_minutes: 1,
    max_increase_tl: 10000,
    max_single_change_pct: 0,
    price_cut_tl: 0.1,
    blacklisted: false,
  };
  const product = {
    marketplace: "HEPSIBURADA",
    barcode: "HB-SKU",
    merchant_sku: "HB-SKU",
    hb_sku: "HBCV1",
    product_name: "Obaçay 1kg",
    rank: null,
    buybox_price: 499,
    buybox_updated_at: new Date(now).toISOString(),
    my_price: 499,
    min_price: 569.14,
    calculated_product_cost: 310,
    calculated_shipping_cost: 94.2,
    calculated_net_profit: -8.22,
    commission_rate: 17,
    service_fee: 13.19,
    packaging_cost: 5,
    packaging_rule_id: 1,
    target_profit: 50,
    desi: 1,
    auto_update: true,
    is_active: true,
    on_sale: true,
    stock_quantity: 10,
    locked: false,
    data_complete: true,
  };
  const global = {
    dryRun: false,
    repricerEnabled: true,
    unlimitedIncrease: true,
    buyboxMaxAgeMinutes: 15,
    minChangeTl: 5,
  };
  const offer = {
    id: 10,
    supplier_code: "BIM",
    offer_type: "LIVE",
    current_price: 310,
    availability: "AVAILABLE",
    checked_at: new Date(now).toISOString(),
    last_seen_at: new Date(now).toISOString(),
    raw_data: {},
  };
  const row = {
    id: 1,
    barcode: product.barcode,
    cost_item_id: 1,
    cost_item_code: "TEA",
    quantity: "1.0000",
    lifecycle_status: "ACTIVE",
    price_source: "BIM",
    canonical_unit_cost: "310.0000",
    unit_desi: "1.0000",
    effective_unit_cost: null,
    selected_offers: [offer],
    legacy_offers: [],
  };
  const batch = {
    carrier: "hepsiJET",
    mappings: [row],
    rates: [{ carrier: "hepsiJET", desi_kg: 1, cost_inc_vat: 94.2 }],
    barems: [],
    open: [],
    expenses: [
      {
        barcode: product.barcode,
        configured_commission: 17,
        rule_id: 1,
        configured_packaging: 5,
      },
    ],
  };
  const listing = {
    merchantSku: product.barcode,
    hbSku: product.hb_sku,
    price: 499,
    availableStock: 10,
    isSalable: true,
  };
  const api = {
    async readListingForPrice() {
      gets++;
      return listing;
    },
  };
  const service = new HepsiburadaFloorRecoveryService({
    db: {
      query() {
        throw new Error("unexpected DB access");
      },
    },
    hepsiburada: api,
    enabled: true,
    now: () => now,
  });
  const input = () => ({
    product,
    settings,
    global,
    batch,
    proposal: proposePrice(product, settings),
    today: { actionCount: 0 },
  });
  return {
    product,
    settings,
    global,
    batch,
    offer,
    row,
    listing,
    api,
    service,
    input,
    gets: () => gets,
    now,
  };
}
test("rank NULL: all independent evidence permits only the verified upward floor", async () => {
  const f = fixture();
  const r = await f.service.evaluate(f.input());
  assert.equal(r.safety.safe, true);
  assert.deepEqual(r.safety.failures, []);
  assert.equal(r.proposal.proposedPrice, 569.14);
  assert.equal(r.proposal.action, "MIN_FIYATA_TOPARLA");
  assert.equal(r.proposal.expectedProfit, 50);
  assert.equal(f.gets(), 1);
});
test("flag defaults off and explicit off has no DB or external read", async () => {
  assert.equal(
    new HepsiburadaFloorRecoveryService({ db: {}, hepsiburada: {} }).enabled,
    false,
  );
  const f = fixture();
  f.service.enabled = false;
  assert.equal(await f.service.evaluate(f.input()), null);
  assert.equal(f.gets(), 0);
  assert.deepEqual(safetyCheck(f.input()).failures, ["BUYBOX_MISSING"]);
});
for (const [label, change] of [
  [
    "above floor",
    (f) => {
      f.product.my_price = 600;
    },
  ],
  [
    "MANUAL policy",
    (f) => {
      f.settings.mode = "MANUAL";
    },
  ],
  [
    "settings auto_update=false",
    (f) => {
      f.settings.auto_update = false;
    },
  ],
  [
    "product auto_update=false",
    (f) => {
      f.product.auto_update = false;
    },
  ],
  [
    "Trendyol",
    (f) => {
      f.product.marketplace = "TRENDYOL";
    },
  ],
  [
    "normal competitor acquisition",
    (f) => {
      f.product.rank = 2;
      f.product.my_price = 600;
    },
  ],
  [
    "normal own rank retention",
    (f) => {
      f.product.rank = 1;
      f.product.my_price = 600;
    },
  ],
])
  test(`${label} never acquires a floor exception`, async () => {
    const f = fixture();
    change(f);
    assert.equal(await f.service.evaluate(f.input()), null);
    assert.equal(f.gets(), 0);
  });
for (const [label, change, code] of [
  [
    "missing cost",
    (f) => {
      f.product.data_complete = false;
    },
    "HB_FLOOR_OTHER_BLOCKER",
  ],
  [
    "stale cost",
    (f) => {
      f.offer.checked_at = null;
    },
    "HB_FLOOR_SOURCE_STALE",
  ],
  [
    "unavailable supplier",
    (f) => {
      f.offer.availability = "UNAVAILABLE";
    },
    "HB_FLOOR_SOURCE_UNVERIFIED",
  ],
  [
    "wrong source price",
    (f) => {
      f.offer.current_price = 330;
    },
    "HB_FLOOR_SOURCE_PRICE_MISMATCH",
  ],
  [
    "fractional recipe",
    (f) => {
      f.row.quantity = 1.5;
    },
    "HB_FLOOR_RECIPE_UNVERIFIED",
  ],
  [
    "wrong canonical quantity cost",
    (f) => {
      f.product.calculated_product_cost = 305;
    },
    "HB_FLOOR_COST_CHANGED",
  ],
  [
    "duplicate canonical",
    (f) => {
      f.batch.mappings.push({ ...f.row, id: 2 });
    },
    "HB_FLOOR_RECIPE_UNVERIFIED",
  ],
  [
    "open action",
    (f) => {
      f.batch.open.push({ barcode: f.product.barcode });
    },
    "OPEN_ACTION_EXISTS",
  ],
  [
    "commission changed",
    (f) => {
      f.batch.expenses[0].configured_commission = 20;
    },
    "HB_FLOOR_COMMISSION_UNVERIFIED",
  ],
  [
    "packaging changed",
    (f) => {
      f.batch.expenses[0].configured_packaging = 30;
    },
    "HB_FLOOR_EXPENSE_UNVERIFIED",
  ],
  [
    "shipping changed",
    (f) => {
      f.batch.rates[0].cost_inc_vat = 100;
    },
    "HB_FLOOR_SHIPPING_CHANGED",
  ],
  [
    "cooldown",
    (f) => {
      f.product.last_price_change_at = new Date().toISOString();
    },
    "HB_FLOOR_OTHER_BLOCKER",
  ],
  [
    "daily limit",
    (f) => {
      f.settings.daily_action_limit = 0;
    },
    "HB_FLOOR_OTHER_BLOCKER",
  ],
  [
    "stale buybox",
    (f) => {
      f.product.buybox_updated_at = "2020-01-01";
    },
    "HB_FLOOR_OTHER_BLOCKER",
  ],
  [
    "locked product",
    (f) => {
      f.product.locked = true;
    },
    "HB_FLOOR_OTHER_BLOCKER",
  ],
  [
    "global disabled",
    (f) => {
      f.global.repricerEnabled = false;
    },
    "HB_FLOOR_OTHER_BLOCKER",
  ],
  [
    "dry run",
    (f) => {
      f.global.dryRun = true;
    },
    "HB_FLOOR_OTHER_BLOCKER",
  ],
])
  test(`${label}: preserve block, no market GET/POST`, async () => {
    const f = fixture();
    change(f);
    const r = await f.service.evaluate(f.input());
    assert.equal(r.safety.safe, false);
    assert.ok(r.safety.failures.includes(code), JSON.stringify(r.safety));
    assert.equal(f.gets(), 0);
  });
test("rank missing never grants a decrease", async () => {
  const f = fixture(),
    input = f.input();
  input.proposal.proposedPrice = 490;
  input.proposal.action = "FIYAT_DUSUR";
  assert.equal((await f.service.evaluate(input)).safety.safe, false);
  assert.equal(f.gets(), 0);
});
for (const [label, change, code] of [
  [
    "missing price",
    (f) => {
      delete f.listing.price;
    },
    "MARKET_PRICE_MISMATCH",
  ],
  [
    "higher real market price",
    (f) => {
      f.listing.price = 700;
    },
    "MARKET_PRICE_MISMATCH",
  ],
  [
    "other merchant SKU",
    (f) => {
      f.listing.merchantSku = "OTHER";
    },
    "HB_FLOOR_MARKET_IDENTITY_UNVERIFIED",
  ],
  [
    "other HB SKU",
    (f) => {
      f.listing.hbSku = "OTHER";
    },
    "HB_FLOOR_MARKET_IDENTITY_UNVERIFIED",
  ],
  [
    "unknown salability",
    (f) => {
      delete f.listing.isSalable;
    },
    "MARKET_PRODUCT_UNAVAILABLE",
  ],
])
  test(`${label} blocks with independent GET evidence`, async () => {
    const f = fixture();
    change(f);
    const r = await f.service.evaluate(f.input());
    assert.equal(r.safety.safe, false);
    assert.ok(r.safety.failures.includes(code));
  });
test("price evidence supports provider price object", async () => {
  const f = fixture();
  f.listing.price = { value: 499 };
  assert.equal((await f.service.evaluate(f.input())).safety.safe, true);
});
test("429 starts floor-only read cooldown and stops subsequent GETs", async () => {
  const f = fixture();
  let requests = 0;
  f.api.readListingForPrice = async () => {
    requests++;
    throw Object.assign(new Error("rate limit"), { status: 429 });
  };
  for (let i = 0; i < 2; i++)
    assert.ok(
      (await f.service.evaluate(f.input())).safety.failures.includes(
        "HB_FLOOR_RATE_LIMIT",
      ),
    );
  assert.equal(requests, 1);
});
test("last_seen alone is not source-price verification", async () => {
  const f = fixture();
  f.offer.checked_at = null;
  assert.equal((await f.service.evaluate(f.input())).safety.safe, false);
});
test("future price check is not fresh evidence", async () => {
  const f = fixture();
  f.offer.checked_at = new Date(f.now + 100000).toISOString();
  assert.equal((await f.service.evaluate(f.input())).safety.safe, false);
});
test("safe preview fingerprint survives normal repeated reads and rejects changed policy", async () => {
  const f = fixture(),
    r = await f.service.evaluate(f.input());
  const action = {
    id: 4,
    action: "MIN_FIYATA_TOPARLA",
    source: "AUTO",
    old_price: 499,
    proposed_price: r.proposal.proposedPrice,
    safety_checks: r.safety,
  };
  assert.equal(
    (await f.service.evaluate({ ...f.input(), action })).safety.safe,
    true,
  );
  f.settings.min_change_interval_minutes = 2;
  assert.ok(
    (
      await f.service.evaluate({ ...f.input(), action })
    ).safety.failures.includes("STALE_PREVIEW"),
  );
});
test("legacy/manual/reversal actions never get a new executor bypass", async () => {
  const f = fixture(),
    r = await f.service.evaluate(f.input());
  for (const action of [
    { source: "AUTO", safety_checks: {} },
    { source: "MANUAL", safety_checks: r.safety },
    { source: "AUTO", safety_checks: r.safety, reverts_action_id: 8 },
  ]) {
    const result = await f.service.evaluate({
      ...f.input(),
      action: {
        id: 4,
        action: "MIN_FIYATA_TOPARLA",
        old_price: 499,
        proposed_price: 569.14,
        ...action,
      },
    });
    assert.ok(result.safety.failures.includes("HB_FLOOR_ACTION_UNVERIFIED"));
  }
});
test("integer manual desi override is retained", async () => {
  const f = fixture();
  f.product.manual_desi_override = 2;
  f.product.desi = 2;
  f.batch.rates[0].desi_kg = 2;
  assert.equal((await f.service.evaluate(f.input())).safety.safe, true);
  assert.equal(f.product.manual_desi_override, 2);
});
test("verified Bizim quantity tier uses the existing tier selector", async () => {
  const f = fixture();
  f.row.price_source = "BIZIM_MARKET";
  f.offer.supplier_code = "BIZIM_MARKET";
  f.offer.checked_at = null;
  f.offer.raw_data = {
    price_tiers_verified: true,
    price_tiers_source: "BIZIM_PRODUCT_DETAIL",
    price_tiers_verified_at: new Date(f.now).toISOString(),
  };
  f.offer.price_tiers = [{ min_quantity: 3, unit_price: 300 }];
  f.row.quantity = 3;
  f.row.effective_unit_cost = 300;
  f.product.calculated_product_cost = 900;
  f.product.desi = 3;
  f.product.manual_desi_override = 3;
  f.batch.rates[0].desi_kg = 3;
  const r = await f.service.evaluate(f.input());
  assert.equal(r.safety.safe, true);
  assert.ok(r.proposal.proposedPrice > 569.14);
  f.row.effective_unit_cost = 310;
  f.product.calculated_product_cost = 930;
  assert.ok(
    (await f.service.evaluate(f.input())).safety.failures.includes(
      "HB_FLOOR_TIER_MISMATCH",
    ),
  );
});
test("legacy FILE source requires explicit canonical check plus matching API price", async () => {
  const f = fixture();
  f.row.price_source = "FILE_MARKET";
  f.offer.supplier_code = "FILE_MARKET";
  f.offer.checked_at = null;
  f.row.source_checked_at = new Date(f.now).toISOString();
  f.offer.raw_data = { provider: "file-market-api", product_price: 310 };
  f.row.legacy_offers = [f.offer];
  f.row.selected_offers = [];
  assert.equal((await f.service.evaluate(f.input())).safety.safe, true);
  f.row.source_checked_at = "2020-01-01";
  assert.ok(
    (await f.service.evaluate(f.input())).safety.failures.includes(
      "HB_FLOOR_SOURCE_STALE",
    ),
  );
});
test("unavailable selected source never falls back to another live supplier", async () => {
  const f = fixture();
  f.row.legacy_offers = [{ ...f.offer, id: 20 }];
  f.offer.availability = "UNAVAILABLE";
  assert.ok(
    (await f.service.evaluate(f.input())).safety.failures.includes(
      "HB_FLOOR_SOURCE_UNVERIFIED",
    ),
  );
});
test("multi-SKU rate batch fingerprints are identical to single-SKU revalidation", async () => {
  const f = fixture();
  const first = await f.service.evaluate(f.input());
  f.batch.rates.push({ carrier: "hepsiJET", desi_kg: 6, cost_inc_vat: 141.26 });
  const second = await f.service.evaluate(f.input());
  assert.equal(
    first.safety.hbFloorRecovery.fingerprint,
    second.safety.hbFloorRecovery.fingerprint,
  );
});
test("restored known rank still validates destination costs without any Buybox exception", async () => {
  const f = fixture();
  f.product.rank = 2;
  const r = await f.service.evaluate(f.input());
  assert.equal(r.safety.safe, true);
  assert.equal(r.safety.hbFloorRecovery.buyboxException, false);
});
test("PG flat numeric strings and JSON settings numbers have the same policy fingerprint", async () => {
  const f = fixture();
  f.settings.minimum_profit_tl = "50.00";
  const first = await f.service.evaluate(f.input());
  f.settings.minimum_profit_tl = 50;
  const second = await f.service.evaluate(f.input());
  assert.equal(
    first.safety.hbFloorRecovery.fingerprint,
    second.safety.hbFloorRecovery.fingerprint,
  );
});
test("multiple physical components aggregate independently into the verified cost", async () => {
  const f = fixture();
  f.batch.mappings.push({
    ...f.row,
    id: 2,
    cost_item_id: 2,
    cost_item_code: "SECOND",
    quantity: 2,
    canonical_unit_cost: 10,
    unit_desi: 0.2,
    selected_offers: [{ ...f.offer, id: 20, current_price: 10 }],
  });
  f.product.calculated_product_cost = 330;
  f.product.desi = 2;
  f.batch.rates[0].desi_kg = 2;
  const r = await f.service.evaluate(f.input());
  assert.equal(r.safety.safe, true);
  assert.equal(r.proposal.proposedPrice, 593.24);
});
