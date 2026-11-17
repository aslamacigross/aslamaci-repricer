const { createDisposablePostgres } = require("../helpers/disposable-postgres");
const { AuditRepository } = require("../../src/repositories/audit.repository");
const { testPilot, testCommission } = require("../helpers/hepsiburada-pilot");
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
  commissionHook,
  commissionReads,
  enforceClientOnly = false,
  leased = false;
test.before(async () => {
  raw =
    process.env.ASLAMACI_HB_DATABASE === "postgres"
      ? await createDisposablePostgres()
      : await createPglitePool();
  if (raw.realPostgres)
    console.log(
      "REAL POSTGRES:",
      (await raw.query("SELECT version() AS version")).rows[0].version,
    );
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
      if (raw.realPostgres) {
        const client = await raw.connect();
        leased = true;
        return {
          query: async (sql, params) => {
            queries?.push(sql);
            return client.query(sql, params);
          },
          release: () => {
            leased = false;
            client.release();
          },
        };
      }
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
  commissionHook = null;
  commissionReads = 0;
  enforceClientOnly = false;
  await raw.query(`TRUNCATE audit_logs,products,product_settings,repricer_learning,cost_items,file_market_items,repricer_actions,commission_rules,packaging_rules RESTART IDENTITY CASCADE;
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
    readCommissionForPrice: async ({ merchantSku, hbSku }) => {
      commissionReads++;
      if (commissionHook) return commissionHook({ merchantSku, hbSku });
      return testCommission({ merchant_sku: merchantSku, hb_sku: hbSku });
    },
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
    pilot: testPilot({ barcode: "FLOOR", hb_sku: "HBCV-FLOOR" }).pilot,
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
    audit: {
      record: async (a, client) => {
        writes.push(a);
        await new AuditRepository(db).record(a, client);
      },
    },
  });
  executor = new HepsiburadaActionService({
    actions,
    products,
    withTransaction: tx,
    repricer,
    hepsiburada: api,
    hbFloorRecovery: floor,
    audit: {
      record: async (a, client) => {
        writes.push(a);
        await new AuditRepository(db).record(a, client);
      },
    },
  });
});

test("SKU commission proof works with ZERO category rules and persists preview/receipt evidence", async () => {
  await raw.query("DELETE FROM commission_rules");
  const before = await snapshot();
  const preview = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.equal(preview.safetyChecks.safe, true);
  assert.equal(preview.safetyChecks.hbFloorRecovery.commission.rate, 17);
  assert.equal(
    preview.safetyChecks.hbFloorRecovery.commission.vatBasis,
    "INCLUDED",
  );
  assert.deepEqual(await snapshot(), before);
  assert.equal(posted, 0);
  const a = await approvedFloor();
  assert.equal(a.safety_checks.hbFloorRecovery.commission.hbSku, "HBCV-FLOOR");
  const saved = await executor.apply(a.id, "operator");
  const dispatchProof = saved.api_response.floorPreflight.commission;
  assert.equal(
    dispatchProof.fingerprint,
    a.safety_checks.hbFloorRecovery.commission.fingerprint,
  );
  assert.equal(dispatchProof.source, "HEPSIBURADA_COMMISSION_API");
  assert.equal(saved.status, "AWAITING_RESULT");
  assert.equal(posted, 1);
  const after = await snapshot();
  assert.deepEqual(after.recipes, before.recipes);
  assert.deepEqual(after.sources, before.sources);
});

for (const [label, change, code] of [
  ["missing", () => null, "HB_FLOOR_COMMISSION_UNVERIFIED"],
  [
    "stale",
    (e) => ({ ...e, checkedAt: new Date(Date.now() - 301000).toISOString() }),
    "HB_FLOOR_COMMISSION_STALE",
  ],
  [
    "wrong merchant",
    (e) => ({ ...e, merchantId: "other" }),
    "HB_FLOOR_COMMISSION_IDENTITY_UNVERIFIED",
  ],
  [
    "wrong merchantSku",
    (e) => ({ ...e, merchantSku: "OTHER" }),
    "HB_FLOOR_COMMISSION_IDENTITY_UNVERIFIED",
  ],
  [
    "wrong hbSku",
    (e) => ({ ...e, hbSku: "OTHER" }),
    "HB_FLOOR_COMMISSION_IDENTITY_UNVERIFIED",
  ],
  ["rate conflict", (e) => ({ ...e, rate: 18 }), "HB_FLOOR_COMMISSION_CHANGED"],
  [
    "VAT exclusive",
    (e) => ({ ...e, vatBasis: "EXCLUDED" }),
    "HB_FLOOR_COMMISSION_VAT_UNVERIFIED",
  ],
  [
    "VAT unknown",
    (e) => ({ ...e, vatBasis: "UNKNOWN" }),
    "HB_FLOOR_COMMISSION_VAT_UNVERIFIED",
  ],
])
  test(`category rate cannot rescue ${label} SKU evidence`, async () => {
    commissionHook = async () =>
      change(testCommission({ merchant_sku: "FLOOR", hb_sku: "HBCV-FLOOR" }));
    const preview = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
    assert.ok(preview.blockedReasons.includes(code), JSON.stringify(preview));
    assert.equal(
      (
        await repricer.generate({
          marketplace: "HEPSIBURADA",
          barcode: "FLOOR",
          source: "AUTO",
        })
      ).created,
      0,
    );
    assert.equal(posted, 0);
  });

test("provider error remains fail-closed, not a category fallback", async () => {
  commissionHook = async () => {
    throw new Error("mock provider unavailable");
  };
  const preview = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.ok(preview.blockedReasons.includes("HB_FLOOR_EVIDENCE_UNAVAILABLE"));
  assert.equal(posted, 0);
});

test("commission changes after preview invalidate approval even when both sources now agree", async () => {
  const a = await generate();
  await raw.query(
    "UPDATE products SET commission_rate=18 WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
  );
  commissionHook = async ({ merchantSku, hbSku }) =>
    testCommission({
      merchant_sku: merchantSku,
      hb_sku: hbSku,
      commission_rate: 18,
    });
  await assert.rejects(approval.approve(a.id, "operator"));
  assert.equal((await actions.get(a.id)).status, "PENDING");
  assert.equal(posted, 0);
});

test("expired approval commission snapshot requires a fresh preview and leaves PENDING", async () => {
  const a = await generate();
  await raw.query(
    "UPDATE repricer_actions SET safety_checks=jsonb_set(safety_checks,'{hbFloorRecovery,commission,checkedAt}',to_jsonb($2::text)) WHERE id=$1",
    [a.id, new Date(Date.now() - 301000).toISOString()],
  );
  await assert.rejects(approval.approve(a.id, "operator"), {
    code: "HB_FLOOR_COMMISSION_STALE",
  });
  assert.equal((await actions.get(a.id)).status, "PENDING");
  assert.equal(posted, 0);
});

test("a legacy floor action without commission provenance cannot gain approval", async () => {
  const a = await generate();
  await raw.query(
    "UPDATE repricer_actions SET safety_checks=safety_checks #- '{hbFloorRecovery,commission}' WHERE id=$1",
    [a.id],
  );
  await assert.rejects(approval.approve(a.id, "operator"), {
    code: "HB_FLOOR_COMMISSION_UNVERIFIED",
  });
  assert.equal(posted, 0);
});

for (const [label, change] of [
  [
    "SKU commission",
    async () =>
      raw.query(
        "UPDATE products SET commission_rate=18 WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
      ),
  ],
  [
    "supplier price",
    async () =>
      raw.query("UPDATE file_market_items SET current_price=330 WHERE id=1"),
  ],
  [
    "destination tariff",
    async () =>
      raw.query(
        "UPDATE shipping_costs SET cost_inc_vat=120 WHERE marketplace='HEPSIBURADA' AND desi_kg=1",
      ),
  ],
  [
    "manual policy",
    async () =>
      raw.query(
        "UPDATE product_settings SET mode='MANUAL' WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
      ),
  ],
  [
    "floor flag",
    async () => {
      floor.pilot.config().hepsiburadaFloorRecoveryEnabled = false;
    },
  ],
])
  test(`final commission GET observes ${label} change before POST`, async () => {
    const a = await approvedFloor();
    const lastGet = marketReads + 3;
    let final = false,
      changed = false;
    readHook = async (n) => {
      if (n === lastGet) final = true;
    };
    commissionHook = async ({ merchantSku, hbSku }) => {
      if (final) {
        assert.equal(
          leased,
          false,
          "provider GET must finish before final DB transaction",
        );
        await change();
        changed = true;
      }
      return testCommission({ merchant_sku: merchantSku, hb_sku: hbSku });
    };
    await assert.rejects(executor.apply(a.id, "operator"));
    assert.equal(changed, true);
    assert.equal(posted, 0);
    assert.equal((await actions.get(a.id)).status, "FAILED"); // failed BEFORE dispatch only
  });

test("normal HB path with both flags OFF needs no new commission GET", async () => {
  const config = floor.pilot.config();
  config.hepsiburadaFloorRecoveryEnabled = false;
  config.hepsiburadaStrictMerchantIdentityEnabled = false;
  config.hepsiburadaPilotAllowlist = [];
  await raw.query(
    "UPDATE products SET rank=2 WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
  );
  commissionHook = async () => {
    throw new Error("must not call pilot commission API");
  };
  const a = await approvedFloor();
  await executor.apply(a.id, "operator");
  assert.equal(commissionReads, 0);
  assert.equal(posted, 1);
});

test("missing final commission snapshot cannot trigger HTTP inside final validation", async () => {
  executor.withTransaction = () => {
    throw new Error("must reject before transaction");
  };
  await assert.rejects(executor.validatePilotDispatch({}, listing), {
    code: "HB_FLOOR_COMMISSION_UNVERIFIED",
  });
  assert.equal(posted, 0);
});

test("historical Ceylon 2x225 fixture is ONLY a synthetic VAT-inclusive scenario", async () => {
  await raw.query(`DELETE FROM commission_rules;
    UPDATE products SET calculated_product_cost=450,min_price=737.82,my_price=729.99 WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR';
    UPDATE cost_items SET unit_cost=225,unit_desi=0.5 WHERE id=1;
    UPDATE product_cost_mappings SET quantity=2 WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR';
    UPDATE file_market_items SET current_price=225 WHERE id=1;`);
  listing.price = 729.99;
  const preview = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.equal(preview.safetyChecks.safe, true, JSON.stringify(preview));
  assert.equal(preview.proposedPrice, 737.82);
  assert.equal(posted, 0);
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
  commissionHook = async () =>
    testCommission({
      ...listing,
      merchant_sku: listing.merchantSku,
      hb_sku: listing.hbSku,
      commission_rate: 15,
    });
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

async function approvedFloor() {
  const a = await generate();
  await approval.approve(a.id, "operator");
  return a;
}
for (const [label, change] of [
  [
    "source cost",
    async () =>
      raw.query("UPDATE file_market_items SET current_price=330 WHERE id=1"),
  ],
  [
    "MANUAL policy",
    async () =>
      raw.query(
        "UPDATE product_settings SET mode='MANUAL',auto_update=FALSE WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
      ),
  ],
  [
    "product auto_update",
    async () =>
      raw.query(
        "UPDATE products SET auto_update=FALSE WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
      ),
  ],
  [
    "settings auto_update",
    async () =>
      raw.query(
        "UPDATE product_settings SET auto_update=FALSE WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
      ),
  ],
  [
    "runtime floor switch",
    async () => {
      floor.enabled = false;
    },
  ],
  [
    "floor feature flag",
    async () => {
      floor.pilot.config().hepsiburadaFloorRecoveryEnabled = false;
    },
  ],
  [
    "allowlist removal",
    async () => {
      floor.pilot.config().hepsiburadaPilotAllowlist = [];
    },
  ],
  [
    "merchant change",
    async () => {
      floor.pilot.config().hepsiburadaMerchantId = "different-merchant";
    },
  ],
  [
    "inactive product",
    async () =>
      raw.query(
        "UPDATE products SET is_active=FALSE WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
      ),
  ],
  [
    "stock zero",
    async () =>
      raw.query(
        "UPDATE products SET stock_quantity=0 WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
      ),
  ],
  [
    "destination shipping cost",
    async () =>
      raw.query(
        "UPDATE shipping_costs SET cost_inc_vat=120 WHERE marketplace='HEPSIBURADA' AND carrier='hepsiJET' AND desi_kg=1",
      ),
  ],
  [
    "commission",
    async () =>
      raw.query(
        "UPDATE products SET commission_rate=18 WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
      ),
  ],
])
  test(`LAST provider GET: ${label} change blocks dispatch`, async () => {
    const a = await approvedFloor();
    const lastGet = marketReads + 3;
    let changed = false;
    readHook = async (n) => {
      if (n === lastGet) {
        await change();
        changed = true;
      }
    };
    await assert.rejects(executor.apply(a.id, "operator"));
    assert.equal(
      changed,
      true,
      "must exercise the last provider GET, not an earlier check",
    );
    assert.equal(posted, 0);
    assert.equal((await actions.get(a.id)).status, "FAILED");
  });

test("allowlist removal blocks approval, bulk approval and already-approved executor", async () => {
  const a = await generate();
  floor.pilot.config().hepsiburadaPilotAllowlist = [];
  await assert.rejects(approval.approve(a.id, "operator"));
  await assert.rejects(approval.approveMany([a.id], "operator"));
  assert.equal((await actions.get(a.id)).status, "PENDING");
  assert.equal(posted, 0);
});
test("pilot target editing requires a fresh preview; manual edit is not an escape hatch", async () => {
  const a = await generate();
  await assert.rejects(
    approval.editAndApprove(a.id, { proposedPrice: 600 }, "operator"),
    { code: "HB_PILOT_REPREVIEW_REQUIRED" },
  );
  assert.equal((await actions.get(a.id)).status, "PENDING");
});
test("empty pilot list cannot create the rank-unknown floor, including WEB generation", async () => {
  floor.pilot.config().hepsiburadaPilotAllowlist = [];
  const p = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.ok(p.blockedReasons.includes("BUYBOX_MISSING"));
  assert.equal(p.safetyChecks.hbFloorRecovery, undefined);
  // Ordinary WEB previews remain legacy; no floor exception is available.
  const generated = await repricer.generate({
    barcode: "FLOOR",
    marketplace: "HEPSIBURADA",
    source: "AUTO",
  });
  assert.equal(generated.created, 0);
  assert.equal(posted, 0);
});
test("identity-only pilot normal action is proof-bound and cannot survive revocation", async () => {
  const config = floor.pilot.config();
  config.hepsiburadaStrictMerchantIdentityEnabled = true;
  config.hepsiburadaFloorRecoveryEnabled = false;
  config.hepsiburadaPilotAllowlist[0].identity = true;
  const product = await products.get("FLOOR", "HEPSIBURADA");
  await raw.query(
    "UPDATE products SET rank=2,buybox_source=$1 WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
    [floor.pilot.identitySource(product)],
  );
  const a = await generate();
  assert.ok(a.safety_checks.hbPilot);
  assert.equal(a.safety_checks.hbFloorRecovery, undefined);
  await approval.approve(a.id, "operator");
  config.hepsiburadaStrictMerchantIdentityEnabled = false;
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "HB_IDENTITY_SCOPE_REVOKED",
  });
  const result = await repricer.generate({
    barcode: "FLOOR",
    marketplace: "HEPSIBURADA",
    source: "AUTO",
  });
  assert.equal(result.created, 0);
  assert.equal(posted, 0);
});
test("independent generator instances share the DB SKU lock", async () => {
  const otherActions = new ActionRepository(db, actions.withTransaction, {
    costEngine: new CostEngineService(db),
  });
  const other = new RepricerService({
    db,
    actions: otherActions,
    settings: new SettingsRepository(db),
    hbFloorRecovery: floor,
  });
  const result = await Promise.all([
    repricer.generate({
      barcode: "FLOOR",
      marketplace: "HEPSIBURADA",
      source: "AUTO",
    }),
    other.generate({
      barcode: "FLOOR",
      marketplace: "HEPSIBURADA",
      source: "AUTO",
    }),
  ]);
  assert.equal(
    result.reduce((n, r) => n + r.created, 0),
    1,
  );
  assert.equal(
    (await raw.query("SELECT COUNT(*)::int n FROM repricer_decisions")).rows[0]
      .n,
    1,
  );
});
test("accepted POST plus audit failure retains receipt and normal verification", async () => {
  const a = await approvedFloor();
  const record = executor.audit.record;
  executor.audit.record = async (event, client) => {
    if (event.action === "HB_PRICE_ACTION_SENT")
      throw new Error("audit sink unavailable");
    return record(event, client);
  };
  const saved = await executor.apply(a.id, "operator");
  assert.equal(saved.status, "AWAITING_RESULT");
  assert.equal(saved.api_response.auditPending, true);
  assert.equal(saved.api_response.dispatchReceipt.outcome, "ACCEPTED");
  assert.equal(posted, 1);
  assert.equal(
    (await actions.findOpen("FLOOR", db, null, "HEPSIBURADA")).id,
    a.id,
  );
  assert.equal(
    (
      await raw.query(
        "SELECT COUNT(*)::int n FROM audit_logs WHERE action='HB_PRICE_DISPATCH_INTENT' AND entity_id=$1",
        [String(a.id)],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "DUPLICATE_APPLY",
  });
  floor.enabled = false;
  floor.pilot.config().hepsiburadaPilotAllowlist = [];
  const verification = await executor.verifyPriceAction(saved);
  assert.equal(verification.status, "VERIFIED");
  assert.equal(
    (await actions.confirmApplied(a.id, verification)).status,
    "SUCCESS",
  );
  assert.equal(posted, 1);
  assert.equal((await actions.get(a.id)).api_response.auditPending, true);
});
test("accepted POST plus both receipt writes failing retains open SENDING and cannot retry", async () => {
  const a = await approvedFloor();
  actions.recordHbSubmission = async () => {
    throw new Error("DB receipt write unavailable");
  };
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "HB_SUBMISSION_PERSISTENCE_UNCERTAIN",
  });
  assert.equal((await actions.get(a.id)).status, "SENDING");
  assert.equal(posted, 1);
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "DUPLICATE_APPLY",
  });
  assert.equal(posted, 1);
});
test("unknown POST outcome is not FAILED/SUCCESS and is not blindly resent", async () => {
  const a = await approvedFloor();
  let attempts = 0;
  executor.hepsiburada.submitPriceUpdate = async () => {
    attempts++;
    throw new Error("timeout after dispatch may have been accepted");
  };
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "HB_SUBMISSION_OUTCOME_UNKNOWN",
  });
  const saved = await actions.get(a.id);
  assert.equal(saved.status, "SENDING");
  assert.equal(saved.api_response.dispatch.outcome, "UNKNOWN");
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "DUPLICATE_APPLY",
  });
  assert.equal(attempts, 1);
  assert.equal(
    (await actions.findOpen("FLOOR", db, null, "HEPSIBURADA")).id,
    a.id,
  );
});
test("late accepted response after pilot closes still verifies without another POST", async () => {
  const a = await approvedFloor();
  let release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const submit = executor.hepsiburada.submitPriceUpdate;
  executor.hepsiburada.submitPriceUpdate = async (input) => {
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
    return submit(input);
  };
  const applying = executor.apply(a.id, "operator");
  await entered;
  floor.enabled = false;
  floor.pilot.config().hepsiburadaPilotAllowlist = [];
  await assert.rejects(executor.apply(a.id, "second-worker"), {
    code: "DUPLICATE_APPLY",
  });
  release();
  const saved = await applying;
  assert.equal(saved.status, "AWAITING_RESULT");
  assert.equal(posted, 1);
  const verification = await executor.verifyPriceAction(saved);
  assert.equal(verification.status, "VERIFIED");
  assert.equal(
    (await actions.confirmApplied(a.id, verification)).status,
    "SUCCESS",
  );
});
test("receipt retry cannot overwrite a newer verified SUCCESS", async () => {
  const a = await approvedFloor();
  const saved = await executor.apply(a.id, "operator");
  await actions.confirmApplied(a.id, await executor.verifyPriceAction(saved));
  const result = await actions.withTransaction((client) =>
    actions.recordHbSubmission(
      a.id,
      { uploadId: saved.batch_id },
      "retry",
      { auditPending: true },
      client,
    ),
  );
  assert.equal(result.status, "SUCCESS");
  assert.notEqual(result.api_response.auditPending, true);
  assert.equal(posted, 1);
});
test("last GET race can be coordinated with a second real PostgreSQL connection", async () => {
  const a = await approvedFloor();
  const trigger = marketReads + 3;
  let release, entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  readHook = async (n) => {
    if (n === trigger) {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
    }
  };
  const applying = executor.apply(a.id, "worker-1");
  await waiting;
  await raw.query(
    "UPDATE product_settings SET mode='MANUAL',auto_update=FALSE WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
  );
  release();
  await assert.rejects(applying);
  assert.equal(posted, 0);
});
test("existing SENDING claim from an older worker cannot be reclaimed by new executor", async () => {
  const a = await approvedFloor();
  await raw.query("UPDATE repricer_actions SET status='SENDING' WHERE id=$1", [
    a.id,
  ]);
  await assert.rejects(executor.apply(a.id, "new-worker"), {
    code: "DUPLICATE_APPLY",
  });
  assert.equal(posted, 0);
  // This does NOT prove that a paused old binary can be revoked. Such workers
  // must be drained; provider requests already sent cannot be cancelled here.
});
test("real PostgreSQL harness actually leases distinct backend sessions", async () => {
  if (!raw.realPostgres) return; // PGlite suite is explicitly a different gate.
  const one = await raw.connect(),
    two = await raw.connect();
  try {
    assert.notEqual(
      (await one.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
      (await two.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    );
  } finally {
    one.release();
    two.release();
  }
});

test("provider identity conflict is a blocker even when both flags permit the exact SKU", async () => {
  const config = floor.pilot.config();
  config.hepsiburadaStrictMerchantIdentityEnabled = true;
  config.hepsiburadaPilotAllowlist[0].identity = true;
  const product = await products.get("FLOOR", "HEPSIBURADA");
  await raw.query(
    "UPDATE products SET buybox_source=$1,buybox_error_code='HB_MERCHANT_IDENTITY_CONFLICT' WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
    [floor.pilot.identitySource(product)],
  );
  const preview = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.ok(preview.blockedReasons.includes("HB_MERCHANT_IDENTITY_CONFLICT"));
  assert.equal(preview.safetyChecks.safe, false);
  assert.equal(
    (
      await repricer.generate({
        barcode: "FLOOR",
        marketplace: "HEPSIBURADA",
        source: "AUTO",
      })
    ).created,
    0,
  );
  assert.equal(posted, 0);
});

test("a competing old-style action appearing during last GET blocks the new dispatch", async () => {
  const a = await approvedFloor();
  const last = marketReads + 3;
  readHook = async (n) => {
    if (n === last)
      await actions.create({
        ...a,
        status: "APPROVED",
        idempotency_key: "competing-legacy-worker",
      });
  };
  await assert.rejects(executor.apply(a.id, "new-worker"), {
    code: "STALE_PREVIEW",
  });
  assert.equal(posted, 0);
  assert.equal(
    (
      await raw.query(
        "SELECT status FROM repricer_actions WHERE idempotency_key='competing-legacy-worker'",
      )
    ).rows[0].status,
    "APPROVED",
  );
});
test("last GET tariff transition invalidates an otherwise approved target", async () => {
  const a = await approvedFloor();
  const last = marketReads + 3;
  readHook = async (n) => {
    if (n === last)
      await raw.query(
        "INSERT INTO shipping_barems(marketplace,carrier,min_basket,max_basket,cost_ex_vat,cost_inc_vat) VALUES('HEPSIBURADA','hepsiJET',400,599.99,125,150)",
      );
  };
  await assert.rejects(executor.apply(a.id, "operator"));
  assert.equal(posted, 0);
});
test("same explicit idempotency key returns one action and does not dispatch", async () => {
  const a = await generate();
  const results = await Promise.all([actions.create(a), actions.create(a)]);
  assert.equal(results[0].id, a.id);
  assert.equal(results[1].id, a.id);
  assert.equal(
    (await raw.query("SELECT COUNT(*)::int n FROM repricer_actions")).rows[0].n,
    1,
  );
  assert.equal(posted, 0);
});
test("dispatch-intent audit failure rolls back claim before any POST", async () => {
  const a = await approvedFloor();
  executor.audit.record = async () => {
    throw new Error("intent audit failed");
  };
  await assert.rejects(executor.apply(a.id, "operator"), /intent audit failed/);
  assert.equal((await actions.get(a.id)).status, "APPROVED");
  assert.equal(posted, 0);
});

async function identityOnlyAction() {
  const config = floor.pilot.config();
  config.hepsiburadaStrictMerchantIdentityEnabled = true;
  config.hepsiburadaFloorRecoveryEnabled = false;
  config.hepsiburadaPilotAllowlist[0].identity = true;
  const product = await products.get("FLOOR", "HEPSIBURADA");
  await raw.query(
    "UPDATE products SET rank=2,buybox_source=$1 WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
    [floor.pilot.identitySource(product)],
  );
  return approvedFloor();
}
test("identity-only ordinary action retains no floor exception and can execute with valid evidence", async () => {
  const a = await identityOnlyAction();
  assert.equal(a.safety_checks.hbFloorRecovery, undefined);
  assert.equal(
    (await executor.apply(a.id, "operator")).status,
    "AWAITING_RESULT",
  );
  assert.equal(posted, 1);
});
test("identity-only last GET cannot dispatch with changed supplier cost", async () => {
  const a = await identityOnlyAction();
  const last = marketReads + 1;
  readHook = async (n) => {
    if (n === last)
      await raw.query(
        "UPDATE file_market_items SET current_price=330 WHERE id=1",
      );
  };
  await assert.rejects(executor.apply(a.id, "operator"));
  assert.equal(posted, 0);
});
test("identity-only does not auto-enable a floor target correction at a new tariff", async () => {
  const a = await identityOnlyAction();
  const last = marketReads + 1;
  // Current price remains in the original interval; only the target becomes
  // expensive. Cached-current-shipping alone must not certify this action.
  readHook = async (n) => {
    if (n === last)
      await raw.query(
        "INSERT INTO shipping_barems(marketplace,carrier,min_basket,max_basket,cost_ex_vat,cost_inc_vat) VALUES('HEPSIBURADA','hepsiJET',550,599.99,125,150)",
      );
  };
  await assert.rejects(executor.apply(a.id, "operator"));
  assert.equal(posted, 0);
  assert.equal((await actions.get(a.id)).proposed_price, a.proposed_price);
});

for (const flagsOff of [false, true]) {
  test(`FAZ 2D.19 C1 replay: Processing at 61m keeps barrier and one POST (flagsOff=${flagsOff})`, async () => {
    const { LearningService } = require("../../src/services/learning.service");
    if (flagsOff) {
      repricer.hbFloorRecovery.enabled = false;
      const config = repricer.hbFloorRecovery.pilot.config();
      config.hepsiburadaFloorRecoveryEnabled = false;
      config.hepsiburadaStrictMerchantIdentityEnabled = false;
      config.hepsiburadaPilotAllowlist = [];
      await raw.query(
        "UPDATE products SET rank=2 WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
      );
    }
    executor.hepsiburada.submitPriceUpdate = async () => ({
      uploadId: `ACCEPTED-STILL-PENDING-${++posted}`,
      response: { status: "Accepted" },
    });
    executor.hepsiburada.getListingUploadStatus = async () => ({
      status: "Processing",
    });
    const first = await generate();
    await approval.approve(first.id, "isolated-review");
    await executor.apply(first.id, "isolated-review");
    await raw.query(
      "UPDATE repricer_actions SET sent_at=NOW()-INTERVAL '61 minutes' WHERE id=$1",
      [first.id],
    );
    const learning = new LearningService({
      actions,
      marketplace: "HEPSIBURADA",
      sync: { verifyPriceAction: (a) => executor.verifyPriceAction(a) },
      audit: { record: async () => {}, integration: async () => {} },
    });
    await learning.verifyPendingActions();
    const saved = await actions.get(first.id);
    await raw.query(
      "UPDATE products SET buybox_price=501,buybox_updated_at=NOW() WHERE marketplace='HEPSIBURADA' AND barcode='FLOOR'",
    );
    const next = await repricer.generate({
      barcode: "FLOOR",
      marketplace: "HEPSIBURADA",
      source: "AUTO",
    });
    console.log(
      JSON.stringify({
        replay: "FAZ2D19",
        flagsOff,
        realPostgres: Boolean(raw.realPostgres),
        firstId: first.id,
        firstTarget: Number(first.proposed_price),
        state: saved.status,
        openId: (await actions.findOpen("FLOOR", db, null, "HEPSIBURADA"))?.id,
        newActions: next.created,
        totalMockPosts: posted,
        secondPosts: posted - 1,
      }),
    );
    assert.equal(saved.status, "AWAITING_RESULT");
    assert.equal(next.created, 0);
    assert.equal(posted, 1);
    assert.match(saved.verification_error, /RECONCILIATION_REQUIRED/);
    executor.hepsiburada.getListingUploadStatus = async () => ({
      status: "Done",
    });
    listing.price = Number(first.proposed_price);
    await learning.verifyPendingActions(first.id);
    assert.equal((await actions.get(first.id)).status, "SUCCESS");
    assert.equal(posted, 1);
  });
}
