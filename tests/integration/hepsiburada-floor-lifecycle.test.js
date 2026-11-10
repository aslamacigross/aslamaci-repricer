const test = require("node:test");
const assert = require("node:assert/strict");
const { migrate } = require("../../src/db/migrate");
const { createPglitePool } = require("../helpers/pglite-pool");
const {
  ActionRepository,
} = require("../../src/repositories/action.repository");
const {
  ProductRepository,
} = require("../../src/repositories/product.repository");
const {
  SettingsRepository,
} = require("../../src/repositories/settings.repository");
const { RepricerService } = require("../../src/services/repricer.service");
const { ActionService } = require("../../src/services/action.service");
const {
  HepsiburadaActionService,
} = require("../../src/services/hepsiburada-action.service");
const {
  HepsiburadaFloorRecoveryService,
} = require("../../src/services/hepsiburada-floor-recovery.service");
const { CostEngineService } = require("../../src/services/cost-engine.service");

let raw,
  db,
  queries,
  transactions = Promise.resolve(),
  writes,
  posted,
  floor,
  repricer,
  actions,
  products,
  executor,
  approval,
  listing,
  marketReads,
  readHook,
  enforceClientOnly = false,
  leased = false;
test.before(async () => {
  raw = await createPglitePool();
  // Existing schema in a disposable in-memory DB only; never Railway credentials.
  await migrate("up", raw);
  // Deterministic transaction/concurrency harness. PGlite is single-session;
  // serialize its transaction owners, do not claim real multi-session MVCC.
  db = {
    query: async (sql, params) => {
      if (enforceClientOnly && leased)
        throw new Error("pool query while transaction owns a client");
      queries?.push(sql);
      return raw.query(sql, params);
    },
    connect: async () => {
      const previous = transactions;
      let release;
      transactions = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      leased = true;
      return {
        query: async (sql, params) => {
          queries?.push(sql);
          return raw.query(sql, params);
        },
        release: () => {
          leased = false;
          release();
        },
      };
    },
  };
});
test.after(async () => raw.end());
test.beforeEach(async () => {
  queries = [];
  writes = [];
  posted = 0;
  marketReads = 0;
  readHook = null;
  enforceClientOnly = false;
  await raw.query(`TRUNCATE products,product_settings,repricer_learning,cost_items,file_market_items,repricer_actions,commission_rules,packaging_rules RESTART IDENTITY CASCADE;
    DELETE FROM shipping_costs; DELETE FROM shipping_barems; DELETE FROM system_settings;
    INSERT INTO system_settings(key,value) VALUES('default_carrier_hepsiburada','"hepsiJET"'),
      ('global_dry_run','false'),('global_repricer_enabled','true'),('global_unlimited_increase','true'),('global_max_price_change_pct','0');
    INSERT INTO commission_rules(marketplace,category_id,commission_rate) VALUES('HEPSIBURADA','TEA',17);
    INSERT INTO packaging_rules(id,min_desi,max_desi,packaging_cost,marketplace,rule_scope,match_value,active,priority)
      VALUES(1,0,99,5,'HEPSIBURADA','BARCODE','FLOOR',TRUE,1);
    INSERT INTO shipping_costs(marketplace,carrier,desi_kg,cost_ex_vat,cost_inc_vat)
      VALUES('HEPSIBURADA','hepsiJET',1,78.5,94.2),('HEPSIBURADA','hepsiJET',3,94,112.8);
    INSERT INTO shipping_barems(marketplace,carrier,min_basket,max_basket,cost_ex_vat,cost_inc_vat)
      VALUES('HEPSIBURADA','hepsiJET',0,199.99,42,50.4),('HEPSIBURADA','hepsiJET',200,399.99,72,86.4);
    INSERT INTO products(marketplace,barcode,merchant_sku,hb_sku,product_name,category_id,my_price,min_price,
      calculated_product_cost,calculated_shipping_cost,calculated_net_profit,commission_rate,desi,packaging_cost,
      packaging_rule_id,service_fee,target_profit,is_active,on_sale,stock_quantity,auto_update,data_complete,buybox_price,buybox_updated_at)
      VALUES('HEPSIBURADA','FLOOR','FLOOR','HBCV-FLOOR','Tea','TEA',499,569.14,310,94.2,-8.22,17,1,5,1,13.19,50,TRUE,TRUE,10,TRUE,TRUE,499,NOW()),
            ('TRENDYOL','FLOOR','TY-FLOOR',NULL,'Separate TY',NULL,999,900,500,100,100,20,1,5,NULL,13,40,TRUE,TRUE,10,FALSE,TRUE,999,NOW());
    INSERT INTO product_settings(marketplace,barcode,mode,strategy,auto_update,minimum_profit_tl,unlimited_increase,
      max_increase_tl,max_single_change_pct,daily_action_limit,min_change_interval_minutes,price_cut_tl)
      VALUES('HEPSIBURADA','FLOOR','AUTOMATIC','Agresif',TRUE,50,TRUE,10000,0,10000,1,0.1);
    INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi,price_source,source_checked_at) VALUES('TEA','Tea',310,1,'BIM',NOW());
    INSERT INTO product_cost_mappings(marketplace,barcode,cost_item_code,quantity) VALUES('HEPSIBURADA','FLOOR','TEA',1);
    INSERT INTO file_market_items(source_key,product_name,normalized_name,current_price,supplier_code,availability,offer_type,checked_at,last_seen_at)
      VALUES('bim:tea','Tea','tea',310,'BIM','AVAILABLE','LIVE',NOW(),NOW());
    INSERT INTO cost_item_supplier_offers(cost_item_id,supplier_offer_id,status,is_selected,approved_by,approved_at,selected_by,selected_at,selection_reason)
      VALUES(1,1,'APPROVED',TRUE,'test',NOW(),'test',NOW(),'test identity');`);
  const tx = async (work) => {
    const client = await db.connect();
    await client.query("BEGIN");
    try {
      const r = await work(client);
      await client.query("COMMIT");
      return r;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  };
  listing = {
    merchantSku: "FLOOR",
    hbSku: "HBCV-FLOOR",
    price: 499,
    availableStock: 10,
    isSalable: true,
  };
  const api = {
    livePriceUpdatesEnabled: () => true,
    readListingForPrice: async () => {
      marketReads++;
      if (readHook) await readHook(marketReads);
      return { ...listing };
    },
    submitPriceUpdate: async ({ price }) => {
      posted++;
      listing.price = price;
      return { uploadId: "MOCK-UPLOAD", response: { id: "MOCK-UPLOAD" } };
    },
    getListingUploadStatus: async () => ({ status: "Done" }),
  };
  actions = new ActionRepository(db, tx, {
    costEngine: new CostEngineService(db),
  });
  products = new ProductRepository(db);
  floor = new HepsiburadaFloorRecoveryService({
    db,
    hepsiburada: api,
    enabled: true,
  });
  repricer = new RepricerService({
    db,
    actions,
    settings: new SettingsRepository(db),
    hbFloorRecovery: floor,
  });
  approval = new ActionService({
    actions,
    products,
    withTransaction: tx,
    repricer,
    audit: { record: async (a) => writes.push(a) },
  });
  executor = new HepsiburadaActionService({
    actions,
    products,
    withTransaction: tx,
    repricer,
    hepsiburada: api,
    hbFloorRecovery: floor,
    audit: { record: async (a) => writes.push(a) },
  });
});
async function generate() {
  const result = await repricer.generate({
    marketplace: "HEPSIBURADA",
    barcode: "FLOOR",
    source: "AUTO",
  });
  assert.equal(result.created, 1, JSON.stringify(result));
  return result.items[0];
}
async function snapshot() {
  return {
    products: (
      await raw.query("SELECT * FROM products ORDER BY marketplace,barcode")
    ).rows,
    recipes: (
      await raw.query("SELECT * FROM product_cost_mappings ORDER BY id")
    ).rows,
    sources: (await raw.query("SELECT * FROM file_market_items ORDER BY id"))
      .rows,
  };
}
test("real SELECT evidence → preview → atomic creation → approval → executor → verified SUCCESS", async () => {
  const before = await snapshot();
  const preview = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.equal(preview.safetyChecks.safe, true, JSON.stringify(preview));
  assert.equal(preview.proposedPrice, 569.14);
  assert.equal(posted, 0);
  assert.deepEqual(await snapshot(), before);
  const a = await generate();
  assert.equal(
    (
      await raw.query(
        "SELECT COUNT(*)::int n FROM repricer_decisions WHERE action_id=$1",
        [a.id],
      )
    ).rows[0].n,
    1,
  );
  await approval.approve(a.id, "operator");
  assert.equal(
    (await executor.apply(a.id, "operator")).status,
    "AWAITING_RESULT",
  );
  assert.equal(posted, 1);
  const verification = await executor.verifyPriceAction(
    await actions.get(a.id),
  );
  assert.equal(verification.status, "VERIFIED");
  assert.equal(
    (await actions.confirmApplied(a.id, verification)).status,
    "SUCCESS",
  );
  assert.equal(
    Number((await products.get("FLOOR", "HEPSIBURADA")).my_price),
    569.14,
  );
  const after = await snapshot();
  assert.deepEqual(after.recipes, before.recipes);
  assert.deepEqual(after.sources, before.sources);
  assert.deepEqual(
    after.products.find((p) => p.marketplace === "TRENDYOL"),
    before.products.find((p) => p.marketplace === "TRENDYOL"),
  );
  assert.ok(
    queries.some(
      (q) => q.includes("FOR UPDATE") && q.includes("FROM products"),
    ),
  );
});
test("two competing generators cannot create two floor actions", async () => {
  const results = await Promise.all([
    repricer.generate({
      marketplace: "HEPSIBURADA",
      barcode: "FLOOR",
      source: "AUTO",
    }),
    repricer.generate({
      marketplace: "HEPSIBURADA",
      barcode: "FLOOR",
      source: "AUTO",
    }),
  ]);
  assert.equal(
    results.reduce((n, r) => n + r.created, 0),
    1,
  );
  assert.equal(
    (await raw.query("SELECT COUNT(*)::int n FROM repricer_actions")).rows[0].n,
    1,
  );
  assert.equal(posted, 0);
});
test("repeated generation/open action does not duplicate or POST", async () => {
  await generate();
  const again = await repricer.generate({
    marketplace: "HEPSIBURADA",
    barcode: "FLOOR",
    source: "AUTO",
  });
  assert.equal(again.created, 0);
  assert.equal(posted, 0);
});
test("concurrent executors claim once, the second cannot POST", async () => {
  const a = await generate();
  await approval.approve(a.id, "operator");
  const results = await Promise.allSettled([
    executor.apply(a.id, "one"),
    executor.apply(a.id, "two"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.find((r) => r.status === "rejected").reason.code,
    "DUPLICATE_APPLY",
  );
  assert.equal(posted, 1);
});
test("flag off after generation blocks executor even for approved proof", async () => {
  const a = await generate();
  await approval.approve(a.id, "operator");
  floor.enabled = false;
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "HB_FLOOR_DISABLED",
  });
  assert.equal(posted, 0);
  assert.equal((await actions.get(a.id)).status, "APPROVED");
});
test("source changed after preview rejects before SENDING", async () => {
  const a = await generate();
  await approval.approve(a.id, "operator");
  await raw.query("UPDATE file_market_items SET current_price=330 WHERE id=1");
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "SAFETY_BLOCKED",
  });
  assert.equal(posted, 0);
  assert.equal((await actions.get(a.id)).status, "APPROVED");
});
test("changed own market price preserves MARKET_PRICE_MISMATCH and sends nothing", async () => {
  const a = await generate();
  await approval.approve(a.id, "operator");
  listing.price = 700;
  await assert.rejects(
    executor.apply(a.id, "operator"),
    (e) =>
      e.code === "MARKET_PRICE_MISMATCH" &&
      e.details.includes("MARKET_PRICE_MISMATCH"),
  );
  assert.equal(posted, 0);
});
test("decision write failure rolls back action creation and leaves other data intact", async () => {
  const before = await snapshot();
  actions.recordDecision = async () => {
    throw new Error("forced decision failure");
  };
  const r = await repricer.generate({
    marketplace: "HEPSIBURADA",
    barcode: "FLOOR",
    source: "AUTO",
  });
  assert.equal(r.created, 0);
  assert.equal(r.failed, 1);
  assert.equal(
    (await raw.query("SELECT COUNT(*)::int n FROM repricer_actions")).rows[0].n,
    0,
  );
  assert.deepEqual(await snapshot(), before);
  assert.equal(posted, 0);
});
test("default off returns original BUYBOX_MISSING with no evidence reads", async () => {
  floor.enabled = false;
  queries = [];
  const r = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.deepEqual(r.blockedReasons, ["BUYBOX_MISSING"]);
  assert.equal(r.safetyChecks.hbFloorRecovery, undefined);
  assert.equal(
    queries.some((q) => q.includes("FROM product_cost_mappings")),
    false,
  );
  assert.equal(posted, 0);
});
test("post-preparation source change stops final preflight without a POST", async () => {
  const a = await generate();
  await approval.approve(a.id, "operator");
  const trigger = marketReads + 2;
  readHook = async (n) => {
    if (n === trigger)
      await raw.query(
        "UPDATE file_market_items SET current_price=330 WHERE id=1",
      );
  };
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "STALE_PREVIEW",
  });
  assert.equal(posted, 0);
  assert.equal((await actions.get(a.id)).status, "FAILED");
});
test("MANUAL change during preflight cannot leak an approved POST", async () => {
  const a = await generate();
  await approval.approve(a.id, "operator");
  const trigger = marketReads + 2;
  readHook = async (n) => {
    if (n === trigger)
      await raw.query(
        "UPDATE product_settings SET mode='MANUAL',auto_update=FALSE WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
      );
  };
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "STALE_PREVIEW",
  });
  assert.equal(posted, 0);
});
test("destination tariff survives complete action flow and confirmed CostEngine refresh", async () => {
  await raw.query(`UPDATE products SET calculated_product_cost=144,desi=3,calculated_shipping_cost=86.4,
    packaging_cost=25,commission_rate=15,target_profit=200,my_price=386.87,min_price=551.28
    WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR';
    UPDATE commission_rules SET commission_rate=15;
    UPDATE packaging_rules SET packaging_cost=25 WHERE id=1;
    UPDATE product_settings SET minimum_profit_tl=200 WHERE marketplace='HEPSIBURADA';
    UPDATE cost_items SET unit_cost=144,unit_desi=3 WHERE id=1;
    UPDATE file_market_items SET current_price=144 WHERE id=1;`);
  listing.price = 386.87;
  const a = await generate();
  assert.equal(Number(a.proposed_price), 582.34);
  assert.equal(Number(a.expected_profit), 200);
  await approval.approve(a.id, "operator");
  await executor.apply(a.id, "operator");
  const verification = await executor.verifyPriceAction(
    await actions.get(a.id),
  );
  await actions.confirmApplied(a.id, verification);
  const p = await products.get("FLOOR", "HEPSIBURADA");
  assert.equal(Number(p.calculated_shipping_cost), 112.8);
  assert.equal(Number(p.min_price), 582.34);
  assert.equal(Number(p.calculated_net_profit), 200);
});
test("failed CostEngine verification rolls back success, price and dependent writes", async () => {
  const a = await generate();
  await approval.approve(a.id, "operator");
  await executor.apply(a.id, "operator");
  actions.costEngine = {
    recalculate: async () => {
      throw new Error("forced cost failure");
    },
  };
  const before = await snapshot();
  const verification = await executor.verifyPriceAction(
    await actions.get(a.id),
  );
  await assert.rejects(
    actions.confirmApplied(a.id, verification),
    /forced cost failure/,
  );
  assert.equal((await actions.get(a.id)).status, "AWAITING_RESULT");
  assert.deepEqual(await snapshot(), before);
});
test("wrong listing identity cannot confirm the floor result", async () => {
  const a = await generate();
  await approval.approve(a.id, "operator");
  await executor.apply(a.id, "operator");
  listing.merchantSku = "OTHER";
  const r = await executor.verifyPriceAction(await actions.get(a.id));
  assert.equal(r.status, "PENDING");
  assert.equal((await actions.get(a.id)).status, "AWAITING_RESULT");
});
test("tampered target cannot use a saved floor certificate", async () => {
  const a = await generate();
  await approval.approve(a.id, "operator");
  await raw.query(
    "UPDATE repricer_actions SET proposed_price=550 WHERE id=$1",
    [a.id],
  );
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "STALE_PREVIEW",
  });
  assert.equal(posted, 0);
});
test("floor transactions reuse their leased client without pool starvation", async () => {
  enforceClientOnly = true;
  const a = await generate();
  await approval.approve(a.id, "operator");
  await executor.apply(a.id, "operator");
  assert.equal(posted, 1);
});
test("blocked WEB floor candidate cannot fall back to ordinary action creation", async () => {
  await raw.query(
    "UPDATE file_market_items SET checked_at='2020-01-01' WHERE id=1",
  );
  const result = await repricer.generate({
    marketplace: "HEPSIBURADA",
    barcode: "FLOOR",
    source: "WEB",
  });
  assert.equal(result.created, 0);
  assert.equal(result.skipped, 1);
  assert.equal(
    (await raw.query("SELECT COUNT(*)::int n FROM repricer_actions")).rows[0].n,
    0,
  );
  assert.equal(posted, 0);
});
test("flag on rejects a legacy floor action even after merchant rank becomes known", async () => {
  const a = await generate();
  await approval.approve(a.id, "operator");
  await raw.query(
    "UPDATE repricer_actions SET safety_checks='{}'::jsonb WHERE id=$1",
    [a.id],
  );
  await raw.query(
    "UPDATE products SET rank=2 WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
  );
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "HB_FLOOR_ACTION_UNVERIFIED",
  });
  assert.equal(posted, 0);
});
