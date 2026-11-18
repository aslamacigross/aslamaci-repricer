const fs = require("fs");
const path = require("path");
const {
  HepsiburadaCashEconomyService,
  VERSION: CASH_VERSION,
} = require("../../src/services/hepsiburada-cash-economy.service");
const { cashFixture } = require("../helpers/hepsiburada-cash-fixture");
const {
  evidenceFromResponse,
} = require("../../src/domain/hepsiburada-commission-evidence");
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

let cash,
  cashConfig,
  engine,
  tx,
  raw,
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
  await raw.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../src/db/migrations/044_hb_cash_economy.DRAFT.sql",
      ),
      "utf8",
    ),
  );
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
  tx = async (work) => {
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
      return evidenceFromResponse([{ sku: hbSku, commissionRate: 17 }], {
        merchantId: "test-merchant",
        merchantSku,
        hbSku,
      });
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
    enabled: false,
    pilot: testPilot({ barcode: "FLOOR", hb_sku: "HBCV-FLOOR" }).pilot,
  });
  repricer = new RepricerService({
    db,
    actions,
    settings: new SettingsRepository(db),
    hbFloorRecovery: floor,
  });
  const f = cashFixture();
  cashConfig = {
    hepsiburadaMerchantId: "test-merchant",
    hepsiburadaCashEconomyMode: "ENFORCE",
    hepsiburadaCashWorkerProtocol: CASH_VERSION,
    hepsiburadaCashAllowlist: [
      {
        marketplace: "HEPSIBURADA",
        merchantId: "test-merchant",
        merchantSku: "FLOOR",
        hbSku: "HBCV-FLOOR",
      },
    ],
    hepsiburadaCashContract: {
      ...f.contract,
      merchantId: "test-merchant",
      validFrom: new Date(Date.now() - 3600000).toISOString(),
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      pricingBaseEvidence: [
        {
          source: "HB_REVIEWED_SKU_BASE",
          merchantId: "test-merchant",
          merchantSku: "FLOOR",
          hbSku: "HBCV-FLOOR",
          revision: "base-fixture-1",
          checkedAt: new Date().toISOString(),
          rule: "LISTING_PRICE_NO_CAMPAIGN",
          sellerFundedDiscount: 0,
          hbFundedDiscount: 0,
        },
      ],
      expenseEvidence: {
        source: "HB_REVIEWED_EXPENSE_PROFILE",
        merchantId: "test-merchant",
        merchantSku: "FLOOR",
        hbSku: "HBCV-FLOOR",
        revision: "fixture-expense-1",
        checkedAt: new Date().toISOString(),
        otherCostsKnown: true,
        otherVerifiedCosts: 0,
      },
    },
  };
  cash = new HepsiburadaCashEconomyService({
    db,
    hepsiburada: api,
    floor,
    config: () => cashConfig,
  });
  repricer.hbCashEconomy = cash;
  floor.hbCashEconomy = cash;
  engine = new CostEngineService(db, { hbCashEconomy: cash });
  actions.costEngine = engine;
  await raw.query("UPDATE products SET rank=2 WHERE marketplace='HEPSIBURADA'");
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

async function hb() {
  return products.get("FLOOR", "HEPSIBURADA");
}
async function newAction() {
  const result = await repricer.generate({
    barcode: "FLOOR",
    marketplace: "HEPSIBURADA",
    source: "AUTO",
  });
  assert.equal(result.created, 1, JSON.stringify(result));
  return result.items[0];
}
async function approved() {
  const a = await newAction();
  return approval.approve(a.id, "fixture-operator");
}

test("OFF CostEngine and preview preserve legacy scalars, no external GET", async () => {
  cashConfig.hepsiburadaCashEconomyMode = "OFF";
  await engine.recalculate("FLOOR", db, "HEPSIBURADA");
  const p = await hb();
  assert.equal(Number(p.calculated_net_profit), -8.22);
  assert.equal(Number(p.min_price), 569.14);
  assert.equal(p.hb_cash_economics, null);
  assert.equal(marketReads, 0);
  assert.equal(commissionReads, 0);
  const preview = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.equal(preview.economicComparison, undefined);
  assert.equal(posted, 0);
});
test("SHADOW CostEngine caches separate cash economics without changing legacy price authority", async () => {
  cashConfig.hepsiburadaCashEconomyMode = "SHADOW";
  await engine.recalculate("FLOOR", db, "HEPSIBURADA");
  const p = await hb();
  assert.equal(Number(p.calculated_net_profit), -8.22);
  assert.equal(Number(p.min_price), 569.14);
  assert.equal(p.hb_cash_economics.applied, false);
  assert.equal(p.hb_cash_economics.contribution, -25.19);
  assert.equal(p.hb_cash_economics.commission.gross, 101.8);
  assert.equal(p.hb_cash_economics.pricingAuthorized, false);
  assert.equal(posted, 0);
  const preview = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.equal(preview.economicComparison.mode, "SHADOW");
  assert.equal(preview.proposedPrice, 569.14);
});
test("ENFORCE CostEngine uses 20.4 effective rate exactly once and destination floor meets 50 TL", async () => {
  await engine.recalculate("FLOOR", db, "HEPSIBURADA");
  const p = await hb();
  const c = p.hb_cash_economics;
  assert.equal(Number(p.commission_rate), 17);
  assert.equal(c.effectiveRate, 20.4);
  assert.equal(Number(p.calculated_net_profit), -25.19);
  assert.equal(c.applied, true);
  assert.equal(Number(p.min_price), 593.46);
  assert.equal(c.targetShipping, 94.2);
  const preview = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.equal(preview.safetyChecks.safe, true, JSON.stringify(preview));
  assert.equal(preview.proposedPrice, 593.46);
  assert.ok(preview.expectedProfit >= 50);
  assert.equal(posted, 0);
});
test("preview / approval / executor / receipt / verification share cash fingerprint and no second POST", async () => {
  const a = await approved();
  assert.equal(a.safety_checks.hbCash.version, CASH_VERSION);
  const sent = await executor.apply(a.id, "fixture-operator");
  assert.equal(sent.status, "AWAITING_RESULT");
  assert.equal(posted, 1);
  assert.equal(
    sent.api_response.cashPreflight.fingerprint,
    a.safety_checks.hbCash.fingerprint,
  );
  assert.equal(sent.api_response.cashPreflight.commission.gross, 121.07);
  await assert.rejects(executor.apply(a.id, "again"), {
    code: "DUPLICATE_APPLY",
  });
  assert.equal(posted, 1);
  const v = await executor.verifyPriceAction(sent);
  assert.equal(v.status, "VERIFIED");
  assert.equal((await actions.confirmApplied(a.id, v)).status, "SUCCESS");
});
for (const [name, change] of [
  [
    "cost",
    () =>
      raw.query("UPDATE cost_items SET unit_cost=350 WHERE item_code='TEA'"),
  ],
  [
    "commission",
    () =>
      raw.query(
        "UPDATE products SET commission_rate=18 WHERE marketplace='HEPSIBURADA'",
      ),
  ],
  [
    "MANUAL",
    () =>
      raw.query(
        "UPDATE product_settings SET mode='MANUAL' WHERE marketplace='HEPSIBURADA'",
      ),
  ],
  [
    "product auto_update",
    () =>
      raw.query(
        "UPDATE products SET auto_update=FALSE WHERE marketplace='HEPSIBURADA'",
      ),
  ],
  [
    "setting auto_update",
    () =>
      raw.query(
        "UPDATE product_settings SET auto_update=FALSE WHERE marketplace='HEPSIBURADA'",
      ),
  ],
  [
    "stock",
    () =>
      raw.query(
        "UPDATE products SET stock_quantity=0 WHERE marketplace='HEPSIBURADA'",
      ),
  ],
  [
    "active",
    () =>
      raw.query(
        "UPDATE products SET is_active=FALSE WHERE marketplace='HEPSIBURADA'",
      ),
  ],
  [
    "shipping tariff",
    () =>
      raw.query(
        "UPDATE shipping_costs SET cost_inc_vat=120 WHERE marketplace='HEPSIBURADA'",
      ),
  ],
  [
    "global policy",
    () =>
      raw.query(
        "UPDATE system_settings SET value='false' WHERE key='global_repricer_enabled'",
      ),
  ],
  [
    "cash mode",
    async () => {
      cashConfig.hepsiburadaCashEconomyMode = "OFF";
    },
  ],
  [
    "allowlist",
    async () => {
      cashConfig.hepsiburadaCashAllowlist = [];
    },
  ],
])
  test(`last commission GET concurrent ${name} change blocks POST`, async () => {
    const a = await approved();
    let changed = false;
    commissionHook = async ({ merchantSku, hbSku }) => {
      if (marketReads >= 3 && !changed) {
        changed = true;
        await change();
      }
      return evidenceFromResponse([{ sku: hbSku, commissionRate: 17 }], {
        merchantId: "test-merchant",
        merchantSku,
        hbSku,
      });
    };
    await assert.rejects(executor.apply(a.id, "operator"));
    assert.equal(changed, true);
    assert.equal(posted, 0);
  });
for (const [name, modify] of [
  ["wrong merchant", (q) => ({ ...q, merchantId: "another-merchant" })],
  ["wrong merchantSku", (q) => ({ ...q, merchantSku: "another-sku" })],
  ["wrong hbSku", (q) => ({ ...q, hbSku: "another-hb" })],
  [
    "stale",
    (q) => ({ ...q, checkedAt: new Date(Date.now() - 3600000).toISOString() }),
  ],
  ["conflicting VAT", (q) => ({ ...q, vatBasis: "INCLUDED" })],
  ["missing rate", (q) => ({ ...q, rate: null })],
])
  test(`cash proof rejects ${name}`, async () => {
    commissionHook = async ({ merchantSku, hbSku }) =>
      modify(
        evidenceFromResponse([{ sku: hbSku, commissionRate: 17 }], {
          merchantId: "test-merchant",
          merchantSku,
          hbSku,
        }),
      );
    const p = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
    assert.equal(p.safetyChecks.safe, false);
    assert.equal(posted, 0);
  });
test("unknown expenses and ambiguous campaign base fail closed", async () => {
  cashConfig.hepsiburadaCashContract.expenseEvidence.otherCostsKnown = false;
  assert.equal(
    (await repricer.preview("FLOOR", "HEPSIBURADA"))[0].safetyChecks.safe,
    false,
  );
  cashConfig.hepsiburadaCashContract.expenseEvidence.otherCostsKnown = true;
  cashConfig.hepsiburadaCashContract.pricingBaseEvidence[0].sellerFundedDiscount = 10;
  assert.equal(
    (await repricer.preview("FLOOR", "HEPSIBURADA"))[0].safetyChecks.safe,
    false,
  );
  assert.equal(posted, 0);
});
test("empty exact cash allowlist and disabled floor flags grant no floor exception", async () => {
  cashConfig.hepsiburadaCashAllowlist = [];
  await raw.query(
    "UPDATE products SET rank=NULL WHERE marketplace='HEPSIBURADA'",
  );
  const p = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.equal(p.economicComparison, undefined);
  assert.ok(p.blockedReasons.includes("BUYBOX_MISSING"));
  assert.equal(posted, 0);
});
test("price edits require fresh economic preview instead of inheriting frozen authorization", async () => {
  const a = await newAction();
  await assert.rejects(approval.editAndApprove(a.id, 610, "operator"));
  assert.equal((await actions.get(a.id)).status, "PENDING");
  assert.equal(posted, 0);
});
test("old unproven action does not acquire authority after enabling cash model", async () => {
  cashConfig.hepsiburadaCashEconomyMode = "OFF";
  const a = await newAction();
  cashConfig.hepsiburadaCashEconomyMode = "ENFORCE";
  await assert.rejects(approval.approve(a.id, "operator"), {
    code: "HB_CASH_PREVIEW_REQUIRED",
  });
  assert.equal(posted, 0);
});
test("cash state and audit rollback if dispatch intent audit fails", async () => {
  const a = await approved();
  executor.audit.record = async () => {
    throw new Error("audit unavailable");
  };
  await assert.rejects(executor.apply(a.id, "operator"));
  assert.equal((await actions.get(a.id)).status, "APPROVED");
  assert.equal(posted, 0);
});
test("accepted POST plus audit failure retains receipt, cash proof and open verification", async () => {
  const a = await approved();
  const record = executor.audit.record;
  executor.audit.record = async (e, c) => {
    if (e.action === "HB_PRICE_ACTION_SENT")
      throw new Error("audit unavailable");
    return record(e, c);
  };
  const sent = await executor.apply(a.id, "operator");
  assert.equal(sent.status, "AWAITING_RESULT");
  assert.equal(sent.api_response.auditPending, true);
  assert.equal(sent.api_response.cashPreflight.version, CASH_VERSION);
  assert.equal(posted, 1);
});
test("two generators serialize exact cash SKU and only one open action exists", async () => {
  const r = await Promise.all([
    repricer.generate({
      barcode: "FLOOR",
      marketplace: "HEPSIBURADA",
      source: "AUTO",
    }),
    repricer.generate({
      barcode: "FLOOR",
      marketplace: "HEPSIBURADA",
      source: "AUTO",
    }),
  ]);
  assert.equal(
    r.reduce((n, x) => n + x.created, 0),
    1,
  );
  assert.equal(
    (await raw.query("SELECT * FROM repricer_actions WHERE status='PENDING'"))
      .rows.length,
    1,
  );
  assert.equal(posted, 0);
});
test("two executors cannot POST the same cash action twice", async () => {
  const a = await approved();
  const r = await Promise.allSettled([
    executor.apply(a.id, "one"),
    executor.apply(a.id, "two"),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(posted, 1);
});
test("other marketplace and protected MANUAL stay separate", async () => {
  const before = await products.get("FLOOR", "TRENDYOL");
  await engine.recalculate("FLOOR", db, "HEPSIBURADA");
  assert.deepEqual(await products.get("FLOOR", "TRENDYOL"), before);
  await raw.query(
    "UPDATE product_settings SET mode='MANUAL',auto_update=FALSE WHERE marketplace='HEPSIBURADA'",
  );
  const p = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.equal(p.safetyChecks.safe, false);
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

test("cash minimum remains a cost floor when current price is already higher", async () => {
  listing.price = 1000;
  await raw.query(
    "UPDATE products SET my_price=1000 WHERE marketplace='HEPSIBURADA'",
  );
  await engine.recalculate("FLOOR", db, "HEPSIBURADA");
  assert.equal(Number((await hb()).min_price), 593.46);
});
test("normal acquisition uses cash floor while retaining competitive rank targeting", async () => {
  listing.price = 700;
  await raw.query(
    "UPDATE products SET my_price=700,rank=2,buybox_price=650,second_price=700 WHERE marketplace='HEPSIBURADA'",
  );
  const p = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.equal(p.action, "FIYAT_DUSUR");
  assert.equal(p.targetRank, 1);
  assert.equal(p.proposedPrice, 649.85);
  assert.ok(p.expectedProfit >= 50);
  assert.equal(p.economicComparison.version, CASH_VERSION);
});
test("normal rank1 retention/hidden floor cannot cut below cash contribution floor", async () => {
  listing.price = 700;
  await raw.query(
    "UPDATE products SET my_price=700,rank=1,buybox_price=700,second_price=800,third_price=850 WHERE marketplace='HEPSIBURADA'",
  );
  const p = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.ok(p.proposedPrice >= 593.46);
  assert.ok(p.expectedProfit >= 50);
  assert.equal(p.safetyChecks.safe, true, JSON.stringify(p));
});
test("MANUAL explicit preview still requires cash target profit and a fresh action", async () => {
  await assert.rejects(
    repricer.manualAction("FLOOR", 580, "operator", {
      marketplace: "HEPSIBURADA",
    }),
    { code: "SAFETY_BLOCKED" },
  );
  const a = await repricer.manualAction("FLOOR", 600, "operator", {
    marketplace: "HEPSIBURADA",
  });
  assert.equal(a.status, "PENDING");
  assert.equal(a.safety_checks.hbCash.mode, "ENFORCE");
  assert.ok(Number(a.expected_profit) >= 50);
  assert.equal(posted, 0);
});
test("batch approval rolls back all selected actions when one economic proof changes", async () => {
  const a = await newAction();
  await raw.query(
    "UPDATE repricer_actions SET safety_checks=jsonb_set(safety_checks,'{hbCash,version}','\"OLD_ECONOMY\"') WHERE id=$1",
    [a.id],
  );
  await assert.rejects(approval.approveMany([a.id], "operator"));
  assert.equal((await actions.get(a.id)).status, "PENDING");
  assert.equal(posted, 0);
});
test("new worker rejects mismatched economic version and missing all-worker declaration", async () => {
  const a = await approved();
  await raw.query(
    "UPDATE repricer_actions SET safety_checks=jsonb_set(safety_checks,'{hbCash,version}','\"OLD_ECONOMY\"') WHERE id=$1",
    [a.id],
  );
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "HB_CASH_PREVIEW_REQUIRED",
  });
  assert.equal(posted, 0);
  cashConfig.hepsiburadaCashWorkerProtocol = "OLD_WORKER";
  await assert.rejects(cash.prepare(await hb()), {
    code: "HB_CASH_WORKER_PROTOCOL_REQUIRED",
  });
});
test("stale reviewed SKU base/expense/contract are UNKNOWN, not zero expenses", async () => {
  for (const field of ["base", "expense", "contract"]) {
    const saved = structuredClone(cashConfig.hepsiburadaCashContract);
    if (field === "base")
      cashConfig.hepsiburadaCashContract.pricingBaseEvidence[0].checkedAt =
        new Date(Date.now() - 3600000).toISOString();
    if (field === "expense")
      cashConfig.hepsiburadaCashContract.expenseEvidence.checkedAt = new Date(
        Date.now() - 2 * 86400000,
      ).toISOString();
    if (field === "contract")
      cashConfig.hepsiburadaCashContract.validUntil = new Date(
        Date.now() - 1000,
      ).toISOString();
    await assert.rejects(cash.prepare(await hb()));
    cashConfig.hepsiburadaCashContract = saved;
  }
  assert.equal(posted, 0);
});
test("other reviewed expenses are deducted once and floor satisfies the exact profit target", async () => {
  cashConfig.hepsiburadaCashContract.expenseEvidence.otherVerifiedCosts = 12.34;
  const p = await cash.prepare(await hb());
  assert.equal(p.calculated_net_profit, -37.53);
  assert.equal(p.min_price, 608.96);
  const proposal = cash.proposal(p, { proposedPrice: p.min_price });
  assert.ok(proposal.expectedProfit >= 50);
  assert.ok(proposal.expectedProfit < 50.02);
});
test("destination tariff crossing 399.99 re-solves the cash target instead of using current cheap shipping", async () => {
  listing.price = 399.99;
  await raw.query(
    "UPDATE products SET my_price=399.99,calculated_shipping_cost=86.4 WHERE marketplace='HEPSIBURADA'",
  );
  const p = await cash.prepare(await hb());
  assert.equal(p.min_price, 593.46);
  assert.equal(p.hb_cash_economics.targetShipping, 94.2);
  const target = cash.proposal(p, { proposedPrice: 593.46 });
  assert.ok(target.expectedProfit >= 50);
  assert.equal(target.economicComparison.targetShipping, 94.2);
});
test("ambiguous overlapping tariffs block cash model", async () => {
  await raw.query(
    "INSERT INTO shipping_barems(marketplace,carrier,min_basket,max_basket,cost_ex_vat,cost_inc_vat) VALUES('HEPSIBURADA','hepsiJET',350,450,90,108)",
  );
  await assert.rejects(cash.prepare(await hb()), {
    code: "HB_FLOOR_TARIFF_AMBIGUOUS",
  });
  assert.equal(posted, 0);
});
test("separate floor pilot and cash scopes must BOTH authorize rank UNKNOWN exception", async () => {
  floor.enabled = true;
  await raw.query(
    "UPDATE products SET rank=NULL WHERE marketplace='HEPSIBURADA'",
  );
  const a = await approved();
  assert.equal(a.safety_checks.hbFloorRecovery.version, "HB_SAFE_FLOOR_V1");
  assert.equal(a.safety_checks.hbCash.version, CASH_VERSION);
  const sent = await executor.apply(a.id, "operator");
  assert.equal(sent.status, "AWAITING_RESULT");
  assert.equal(posted, 1);
  assert.ok(sent.api_response.cashPreflight.cashContribution >= 50);
});
test("uncertain external result remains SENDING with frozen economic evidence and cannot retry", async () => {
  const a = await approved();
  executor.hepsiburada.submitPriceUpdate = async () => {
    posted++;
    throw new Error("timeout unknown");
  };
  await assert.rejects(executor.apply(a.id, "operator"), {
    code: "HB_SUBMISSION_OUTCOME_UNKNOWN",
  });
  const saved = await actions.get(a.id);
  assert.equal(saved.status, "SENDING");
  assert.equal(saved.safety_checks.hbCash.version, CASH_VERSION);
  assert.equal(
    (await actions.findOpen("FLOOR", db, null, "HEPSIBURADA")).id,
    a.id,
  );
  await assert.rejects(executor.apply(a.id, "retry"), {
    code: "DUPLICATE_APPLY",
  });
  assert.equal(posted, 1);
});
test("submitted actions still verify after cash mode is disabled", async () => {
  const a = await approved();
  const sent = await executor.apply(a.id, "operator");
  cashConfig.hepsiburadaCashEconomyMode = "OFF";
  const v = await executor.verifyPriceAction(sent);
  assert.equal(v.status, "VERIFIED");
  await actions.confirmApplied(a.id, v);
  assert.equal(posted, 1);
});
test("cache OFF rollback requires explicit refresh before legacy pricing resumes", async () => {
  await engine.recalculate("FLOOR", db, "HEPSIBURADA");
  cashConfig.hepsiburadaCashEconomyMode = "OFF";
  await assert.rejects(cash.prepare(await hb()), {
    code: "HB_CASH_RECALC_REQUIRED",
  });
  await engine.recalculate("FLOOR", db, "HEPSIBURADA");
  const p = await cash.prepare(await hb());
  assert.equal(Number(p.min_price), 569.14);
  assert.equal(p.hb_cash_economics, null);
  assert.equal(posted, 0);
});
test("cash migration draft is not discovered by startup migration runner", async () => {
  assert.equal(
    (
      await raw.query(
        "SELECT version FROM schema_migrations WHERE version LIKE '044%' ",
      )
    ).rows.length,
    0,
  );
  await raw.query("ALTER TABLE products DROP COLUMN hb_cash_economics");
  try {
    await assert.rejects(engine.recalculate("FLOOR", db, "HEPSIBURADA"), {
      code: "HB_CASH_SCHEMA_REQUIRED",
    });
  } finally {
    await raw.query(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../src/db/migrations/044_hb_cash_economy.DRAFT.sql",
        ),
        "utf8",
      ),
    );
  }
  assert.equal(Number((await hb()).min_price), 569.14);
  assert.equal(posted, 0);
});
// Only these tests claim PostgreSQL MVCC. PGlite cannot prove separate sessions.
test(
  "real PG cache refresh cannot expose a temporary legacy floor during provider GET",
  { skip: process.env.ASLAMACI_HB_DATABASE !== "postgres" },
  async () => {
    await engine.recalculate("FLOOR", db, "HEPSIBURADA");
    const before = await hb();
    let enter, release;
    const entered = new Promise((r) => (enter = r));
    const gate = new Promise((r) => (release = r));
    readHook = async () => {
      enter();
      await gate;
    };
    const refresh = engine.recalculate("FLOOR", db, "HEPSIBURADA");
    await entered;
    try {
      const observed = await hb();
      assert.equal(Number(observed.min_price), Number(before.min_price));
      assert.equal(Number(observed.calculated_net_profit), -25.19);
    } finally {
      release();
    }
    await refresh;
  },
);
test(
  "real PG rollback keeps both cash cache and scalars unchanged",
  { skip: process.env.ASLAMACI_HB_DATABASE !== "postgres" },
  async () => {
    const before = await hb();
    await assert.rejects(
      tx(async (c) => {
        await engine.recalculate("FLOOR", c, "HEPSIBURADA");
        throw new Error("rollback fixture");
      }),
    );
    assert.deepEqual(await hb(), before);
    assert.equal(posted, 0);
  },
);
test(
  "real PG distinct verifier sessions preserve open state and no second dispatch",
  { skip: process.env.ASLAMACI_HB_DATABASE !== "postgres" },
  async () => {
    const c1 = await raw.connect(),
      c2 = await raw.connect();
    try {
      assert.notEqual(
        (await c1.query("SELECT pg_backend_pid() AS id")).rows[0].id,
        (await c2.query("SELECT pg_backend_pid() AS id")).rows[0].id,
      );
    } finally {
      c1.release();
      c2.release();
    }
    const a = await approved();
    const sent = await executor.apply(a.id, "operator");
    executor.hepsiburada.getListingUploadStatus = async () => ({
      status: "Processing",
    });
    const results = await Promise.all([
      executor.verifyPriceAction(sent),
      executor.verifyPriceAction(sent),
    ]);
    assert.ok(results.every((x) => x.status === "PENDING"));
    assert.equal((await actions.get(a.id)).status, "AWAITING_RESULT");
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
    assert.equal(posted, 1);
  },
);
for (const [label, edit] of [
  [
    "too many tuples",
    (c) => {
      c.hepsiburadaCashAllowlist = Array.from({ length: 4 }, (_, i) => ({
        marketplace: "HEPSIBURADA",
        merchantId: "test-merchant",
        merchantSku: `M${i}`,
        hbSku: `H${i}`,
      }));
    },
  ],
  [
    "wrong marketplace",
    (c) => {
      c.hepsiburadaCashAllowlist[0].marketplace = "TRENDYOL";
    },
  ],
  [
    "wrong merchant",
    (c) => {
      c.hepsiburadaCashAllowlist[0].merchantId = "wrong";
    },
  ],
  [
    "missing hbSku",
    (c) => {
      delete c.hepsiburadaCashAllowlist[0].hbSku;
    },
  ],
  [
    "duplicate tuple",
    (c) => {
      c.hepsiburadaCashAllowlist.push({ ...c.hepsiburadaCashAllowlist[0] });
    },
  ],
])
  test(`cash scope rejects ${label}`, async () => {
    edit(cashConfig);
    await assert.rejects(cash.prepare(await hb()), {
      code: "HB_CASH_SCOPE_INVALID",
    });
    assert.equal(posted, 0);
  });
test("same merchantSku with different hbSku receives no new economic behavior", async () => {
  cashConfig.hepsiburadaCashAllowlist[0].hbSku = "ANOTHER-HB";
  const p = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
  assert.equal(p.economicComparison, undefined);
  assert.equal(p.proposedPrice, 569.14);
  assert.equal(marketReads, 0);
});
test("conflicting own listing seller ID is not our authenticated SKU", async () => {
  listing.merchantId = "other-seller";
  await assert.rejects(cash.prepare(await hb()), {
    code: "HB_CASH_IDENTITY_UNVERIFIED",
  });
  assert.equal(posted, 0);
});
test("ENFORCE to SHADOW requires explicit cache normalization, never silently carries cash scalars", async () => {
  await engine.recalculate("FLOOR", db, "HEPSIBURADA");
  cashConfig.hepsiburadaCashEconomyMode = "SHADOW";
  await assert.rejects(cash.prepare(await hb()), {
    code: "HB_CASH_RECALC_REQUIRED",
  });
  await engine.recalculate("FLOOR", db, "HEPSIBURADA");
  const p = await cash.prepare(await hb());
  assert.equal(Number(p.min_price), 569.14);
  assert.equal(p.hb_cash_commission, undefined);
});
test("cash pending fingerprint cannot be changed by fresh GET metadata alone", async () => {
  const a = await newAction();
  const proof = a.safety_checks.hbCash;
  assert.equal(proof.evidence.contract.revision, "review-fixture-1");
  assert.equal(proof.evidence.skuBase.merchantSku, "FLOOR");
  assert.equal(proof.evidence.expense.otherCostsKnown, true);
  await new Promise((r) => setTimeout(r, 5));
  await approval.approve(a.id, "operator");
  assert.equal(posted, 0);
});
test("missing economic proof caches UNKNOWN, never a safe zero or legacy cash profit", async () => {
  cashConfig.hepsiburadaCashContract.expenseEvidence.otherCostsKnown = false;
  const result = await engine.recalculate("FLOOR", db, "HEPSIBURADA");
  const p = await hb();
  assert.equal(p.data_complete, false);
  assert.equal(p.calculated_net_profit, null);
  assert.equal(p.min_price, null);
  assert.equal(result.items[0].min_price, null);
  assert.equal(p.hb_cash_economics.applied, false);
  assert.equal(p.hb_cash_economics.legacy.calculated_net_profit, -8.22);
  assert.equal(posted, 0);
});
for (const sql of [
  "UPDATE product_settings SET mode='MANUAL' WHERE marketplace='HEPSIBURADA'",
  "UPDATE products SET auto_update=FALSE WHERE marketplace='HEPSIBURADA'",
  "UPDATE product_settings SET auto_update=FALSE WHERE marketplace='HEPSIBURADA'",
])
  test(`ENFORCE preview itself denies protected automation: ${sql}`, async () => {
    await raw.query(sql);
    const p = (await repricer.preview("FLOOR", "HEPSIBURADA"))[0];
    assert.ok(p.blockedReasons.includes("HB_CASH_POLICY_DENIED"));
    assert.equal(
      (
        await repricer.generate({
          barcode: "FLOOR",
          marketplace: "HEPSIBURADA",
          source: "WEB",
        })
      ).created,
      0,
    );
    assert.equal(posted, 0);
  });
test("successful receipt verification refreshes destination cache with identical economic mode", async () => {
  const a = await approved();
  const sent = await executor.apply(a.id, "operator");
  await actions.confirmApplied(a.id, await executor.verifyPriceAction(sent));
  const p = await hb();
  assert.equal(p.hb_cash_economics.version, CASH_VERSION);
  assert.equal(p.hb_cash_economics.mode, "ENFORCE");
  assert.equal(Number(p.min_price), 593.46);
  assert.equal(Number(p.calculated_net_profit), 50);
  assert.equal(posted, 1);
});

test("expense proof for another exact SKU cannot fill this SKU's unknown mandatory costs", async () => {
  cashConfig.hepsiburadaCashContract.expenseEvidence.hbSku = "ANOTHER";
  await assert.rejects(cash.prepare(await hb()), {
    code: "HB_CASH_EXPENSE_UNVERIFIED",
  });
  assert.equal(posted, 0);
});
test("duplicate expense profiles are ambiguous rather than choosing a cheap one", async () => {
  const e = cashConfig.hepsiburadaCashContract.expenseEvidence;
  cashConfig.hepsiburadaCashContract.expenseEvidence = [
    e,
    { ...e, otherVerifiedCosts: 50 },
  ];
  await assert.rejects(cash.prepare(await hb()), {
    code: "HB_CASH_EXPENSE_UNVERIFIED",
  });
  assert.equal(posted, 0);
});
test(
  "real PG bulk prefetch does not hold catalog row locks while provider GET waits",
  { skip: process.env.ASLAMACI_HB_DATABASE !== "postgres" },
  async () => {
    let enter, release;
    const entered = new Promise((r) => (enter = r));
    const gate = new Promise((r) => (release = r));
    readHook = async () => {
      enter();
      await gate;
    };
    const refresh = engine.recalculate(null, db, "HEPSIBURADA");
    await entered;
    const client = await raw.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT barcode FROM products FOR UPDATE NOWAIT");
      await client.query("ROLLBACK");
    } finally {
      client.release();
      release();
    }
    await refresh;
    assert.equal((await hb()).hb_cash_economics.applied, true);
    assert.equal(posted, 0);
  },
);
test("cache prefetch policy change cannot write an old ENFORCE snapshot", async () => {
  readHook = async () => {
    cashConfig.hepsiburadaCashEconomyMode = "OFF";
  };
  const before = await hb();
  await assert.rejects(engine.recalculate("FLOOR", db, "HEPSIBURADA"), {
    code: "HB_CASH_POLICY_CHANGED",
  });
  assert.deepEqual(await hb(), before);
  assert.equal(posted, 0);
});
