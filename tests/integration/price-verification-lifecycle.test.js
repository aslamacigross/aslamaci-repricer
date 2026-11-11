const test = require("node:test");
const assert = require("node:assert/strict");
const { migrate } = require("../../src/db/migrate");
const { createPglitePool } = require("../helpers/pglite-pool");
const { createDisposablePostgres } = require("../helpers/disposable-postgres");
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
const { LearningService } = require("../../src/services/learning.service");
const { SyncService } = require("../../src/services/sync.service");

let db,
  raw,
  actions,
  products,
  repricer,
  approval,
  executors,
  learning,
  provider,
  posts,
  events;
const realNow = Date.now;
let transactions = Promise.resolve();
test.before(async () => {
  raw =
    process.env.ASLAMACI_HB_DATABASE === "postgres"
      ? await createDisposablePostgres()
      : await createPglitePool();
  await migrate("up", raw);
  db = raw.realPostgres
    ? raw
    : {
        query: raw.query,
        async connect() {
          const previous = transactions;
          let release;
          transactions = new Promise((resolve) => {
            release = resolve;
          });
          await previous;
          return { query: raw.query, release };
        },
      };
  if (raw.realPostgres)
    console.log(
      "VERIFICATION DB:",
      (await db.query("SELECT version() v")).rows[0].v,
    );
});
test.after(async () => raw?.end());
test.beforeEach(async () => {
  await db.query(`TRUNCATE price_war_log,products,product_settings,repricer_actions,repricer_learning RESTART IDENTITY CASCADE;
    DELETE FROM system_settings;
    INSERT INTO system_settings(key,value) VALUES('global_dry_run','false'),('global_repricer_enabled','true'),
    ('global_max_price_change_pct','0'),('global_unlimited_increase','true');`);
  for (const marketplace of ["TRENDYOL", "HEPSIBURADA"]) {
    await db.query(
      `INSERT INTO products(marketplace,barcode,merchant_sku,hb_sku,product_name,my_price,list_price,min_price,
      calculated_product_cost,calculated_shipping_cost,calculated_net_profit,commission_rate,desi,packaging_cost,
      service_fee,target_profit,is_active,on_sale,approved,stock_quantity,auto_update,data_complete,buybox_price,
      second_price,third_price,rank,buybox_updated_at)
      VALUES($1,'VERIFY','VERIFY','HB-VERIFY','Isolated verification',944,944,805,448,141.96,155,17,1,25,
      13.19,40,TRUE,TRUE,TRUE,10,TRUE,TRUE,940,944,960,2,NOW())`,
      [marketplace],
    );
    await db.query(
      `INSERT INTO product_settings(marketplace,barcode,mode,strategy,auto_update,minimum_profit_tl,
      daily_action_limit,min_change_interval_minutes,price_cut_tl,max_single_change_pct,max_daily_change_pct)
      VALUES($1,'VERIFY','AUTOMATIC','Normal',TRUE,40,1000,0,0.1,0,0)`,
      [marketplace],
    );
  }
  actions = new ActionRepository(db);
  products = new ProductRepository(db);
  repricer = new RepricerService({
    db,
    actions,
    settings: new SettingsRepository(db),
  });
  posts = { TRENDYOL: 0, HEPSIBURADA: 0 };
  events = [];
  provider = {};
  const audit = {
    record: async (event) => events.push(event),
    integration: async (event) => events.push(event),
  };
  for (const marketplace of Object.keys(posts)) {
    provider[marketplace] = {
      status: "PENDING",
      price: 944,
      missing: false,
      error: false,
      auditError: false,
      postError: false,
      noReceipt: false,
    };
  }
  const ty = provider.TRENDYOL;
  const trendyol = {
    getProductByBarcode: async () =>
      ty.missing
        ? null
        : { barcode: "VERIFY", salePrice: ty.price, listPrice: ty.price },
    updatePrices: async () => {
      posts.TRENDYOL++;
      if (ty.postError) throw new Error("mock response lost");
      return ty.noReceipt ? {} : { batchRequestId: `TY-${posts.TRENDYOL}` };
    },
    getBatchResult: async (batchId) => {
      if (ty.error) throw new Error("mock GET unavailable");
      return {
        batchRequestId: batchId,
        items:
          ty.status === "UNKNOWN"
            ? []
            : [
                {
                  requestItem: { barcode: "VERIFY" },
                  status: ty.status === "PENDING" ? "IN_PROGRESS" : ty.status,
                  failureReasons: ["mock rejected"],
                },
              ],
      };
    },
  };
  approval = new ActionService({
    db,
    actions,
    products,
    repricer,
    withTransaction: actions.withTransaction,
    trendyol,
    audit: {
      ...audit,
      record: async (event) => {
        if (ty.auditError && event.action === "PRICE_ACTION_SENT")
          throw new Error("mock audit unavailable");
        return audit.record(event);
      },
    },
  });
  const hb = provider.HEPSIBURADA;
  const hbExecutor = new HepsiburadaActionService({
    actions,
    products,
    repricer,
    withTransaction: actions.withTransaction,
    hepsiburada: {
      livePriceUpdatesEnabled: () => true,
      readListingForPrice: async () =>
        hb.missing
          ? null
          : {
              merchantSku: hb.wrongIdentity ? "OTHER" : "VERIFY",
              hbSku: "HB-VERIFY",
              price: hb.price,
              availableStock: 10,
            },
      submitPriceUpdate: async () => {
        posts.HEPSIBURADA++;
        if (hb.postError) throw new Error("mock response lost");
        return {
          uploadId: `HB-${posts.HEPSIBURADA}`,
          response: { status: "Accepted" },
        };
      },
      getListingUploadStatus: async () => {
        if (hb.error) throw new Error("mock GET unavailable");
        return {
          status:
            hb.status === "PENDING"
              ? "Processing"
              : hb.status === "SUCCESS"
                ? "Done"
                : hb.status,
        };
      },
    },
    audit: {
      ...audit,
      record: async (event) => {
        if (hb.auditError && event.action === "HB_PRICE_ACTION_SENT")
          throw new Error("mock audit unavailable");
        return audit.record(event);
      },
    },
  });
  executors = { TRENDYOL: approval, HEPSIBURADA: hbExecutor };
  const sync = new SyncService({ db, trendyol });
  learning = {};
  for (const marketplace of Object.keys(posts))
    learning[marketplace] = new LearningService({
      actions,
      marketplace,
      audit,
      sync: {
        verifyPriceAction: (action) =>
          marketplace === "TRENDYOL"
            ? sync.verifyPriceAction(action)
            : hbExecutor.verifyPriceAction(action),
        buybox: async () => ({ updatedBarcodes: ["VERIFY"], failed: 0 }),
      },
    });
});
async function generate(marketplace, future = false) {
  const now = realNow;
  try {
    Date.now = realNow;
    // The next ordinary validity bucket gives a NEW idempotency key for the SAME target.
    if (future) Date.now = () => now() + 16 * 60000;
    return await repricer.generate({
      barcode: "VERIFY",
      marketplace,
      source: "AUTO",
    });
  } finally {
    Date.now = realNow;
  }
}
async function submitted(marketplace, age = 61) {
  const generated = await generate(marketplace);
  assert.equal(generated.created, 1, JSON.stringify(generated));
  const action = generated.items[0];
  await approval.approve(action.id, "isolated-test");
  await executors[marketplace].apply(action.id, "isolated-test");
  await db.query(
    "UPDATE repricer_actions SET sent_at=NOW()-($2::text||' minutes')::interval WHERE id=$1",
    [action.id, String(age)],
  );
  return actions.get(action.id);
}
for (const marketplace of ["HEPSIBURADA", "TRENDYOL"]) {
  for (const age of [61, 180])
    test(`${marketplace}: Processing ${age}m blocks a new key/target and late completion verifies original`, async () => {
      const first = await submitted(marketplace, age);
      await db.query("UPDATE products SET rank=1 WHERE marketplace=$1", [
        marketplace,
      ]);
      const summary = await learning[marketplace].checkOutcomes(60);
      const state = await actions.get(first.id);
      const next = await generate(marketplace, true);
      if (next.created) {
        await approval.approve(next.items[0].id, "isolated-test");
        await executors[marketplace].apply(next.items[0].id, "isolated-test");
      }
      console.log(
        JSON.stringify({
          marketplace,
          age,
          firstId: first.id,
          status: state.status,
          openId: (await actions.findOpen("VERIFY", db, null, marketplace))?.id,
          nextCreated: next.created,
          mockPosts: posts[marketplace],
          summary,
        }),
      );
      assert.equal(state.status, "AWAITING_RESULT");
      assert.equal(next.created, 0);
      assert.equal(posts[marketplace], 1);
      assert.equal(summary.processed, 0); // Buybox win cannot verify application.
      assert.equal(
        (await actions.findOpen("VERIFY", db, null, marketplace)).id,
        first.id,
      );
      assert.match(state.verification_error, /RECONCILIATION_REQUIRED/);
      // A different target/new key action inserted by a separate worker cannot POST either.
      const second = await actions.create({
        ...first,
        status: "APPROVED",
        proposed_price: Number(first.proposed_price) - 1,
        idempotency_key: `new-key-${marketplace}-${age}`,
        expires_at: new Date(Date.now() + 60000),
      });
      await assert.rejects(
        executors[marketplace].apply(second.id, "isolated-test"),
        (e) => e.code === "OPEN_ACTION_EXISTS",
      );
      assert.equal(posts[marketplace], 1);
      provider[marketplace].status = "SUCCESS";
      provider[marketplace].price = Number(first.proposed_price);
      await learning[marketplace].verifyPendingActions(first.id);
      assert.equal((await actions.get(first.id)).status, "SUCCESS");
      assert.ok((await actions.get(first.id)).verified_at);
      assert.equal((await actions.get(second.id)).status, "APPROVED");
      assert.equal(posts[marketplace], 1);
    });
  for (const kind of ["UNKNOWN", "missing", "mismatch", "error"])
    test(`${marketplace}: ${kind} stays open with receipt at 180m`, async () => {
      const first = await submitted(marketplace, 180);
      if (kind === "UNKNOWN") provider[marketplace].status = "UNKNOWN";
      else {
        provider[marketplace].status = "SUCCESS";
        if (kind === "missing" || kind === "error")
          provider[marketplace][kind] = true;
      }
      await learning[marketplace].verifyPendingActions();
      const saved = await actions.get(first.id);
      assert.equal(saved.status, "AWAITING_RESULT");
      assert.equal(saved.batch_id, first.batch_id);
      assert.deepEqual(
        saved.api_response.submission,
        first.api_response.submission,
      );
      assert.equal(posts[marketplace], 1);
      assert.equal(
        (await actions.findOpen("VERIFY", db, null, marketplace)).id,
        first.id,
      );
    });
  test(`${marketplace}: definitive provider rejection closes with evidence`, async () => {
    const first = await submitted(marketplace);
    provider[marketplace].status = "FAILED";
    await learning[marketplace].verifyPendingActions();
    const saved = await actions.get(first.id);
    assert.equal(saved.status, "FAILED");
    assert.ok(saved.api_response.verification.batch);
    assert.equal(saved.batch_id, first.batch_id);
    assert.equal(
      await actions.findOpen("VERIFY", db, null, marketplace),
      undefined,
    );
  });
  for (const rank of [1, 2])
    test(`${marketplace}: verified application and 60m Buybox rank ${rank} are separate`, async () => {
      const first = await submitted(marketplace);
      provider[marketplace].status = "SUCCESS";
      provider[marketplace].price = Number(first.proposed_price);
      await db.query("UPDATE products SET rank=$2 WHERE marketplace=$1", [
        marketplace,
        rank,
      ]);
      const result = await learning[marketplace].checkOutcomes(60);
      assert.equal(result.processed, 1);
      const saved = await actions.get(first.id);
      assert.equal(saved.status, "SUCCESS");
      assert.ok(saved.verified_at);
      const outcomes = (
        await db.query(
          "SELECT result FROM price_change_outcomes WHERE action_id=$1",
          [first.id],
        )
      ).rows;
      assert.equal(
        outcomes[0].result,
        rank === 1 ? "BUYBOX_WON" : "TARGET_RANK_MISSED",
      );
    });
  test(`${marketplace}: accepted upload survives audit failure, timeout and eventual verification`, async () => {
    provider[marketplace].auditError = true;
    const first = await submitted(marketplace);
    assert.equal(first.status, "AWAITING_RESULT");
    assert.equal(first.api_response.auditPending, true);
    await learning[marketplace].verifyPendingActions();
    assert.equal((await actions.get(first.id)).api_response.auditPending, true);
    provider[marketplace].status = "SUCCESS";
    provider[marketplace].price = Number(first.proposed_price);
    await learning[marketplace].verifyPendingActions();
    assert.equal((await actions.get(first.id)).status, "SUCCESS");
    assert.equal((await actions.get(first.id)).api_response.auditPending, true);
    assert.equal(posts[marketplace], 1);
  });
  test(`${marketplace}: two verifier connections confirm once and stale failure cannot overwrite`, async () => {
    const first = await submitted(marketplace);
    provider[marketplace].status = "SUCCESS";
    provider[marketplace].price = Number(first.proposed_price);
    await Promise.all([
      learning[marketplace].verifyPendingActions(),
      learning[marketplace].verifyPendingActions(),
    ]);
    assert.equal((await actions.get(first.id)).status, "SUCCESS");
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM price_war_log WHERE marketplace=$1 AND barcode='VERIFY'",
          [marketplace],
        )
      ).rows[0].n,
      1,
    );
    await actions.markVerificationFailed(
      first.id,
      "stale failure",
      { status: "FAILED" },
      first.batch_id,
    );
    assert.equal((await actions.get(first.id)).status, "SUCCESS");
  });
  test(`${marketplace}: old SENDING is excluded from verification and outcome jobs`, async () => {
    const generated = await generate(marketplace);
    const first = generated.items[0];
    await actions.updateStatus(first.id, "SENDING");
    await db.query(
      "UPDATE repricer_actions SET sent_at=NOW()-INTERVAL '3 days' WHERE id=$1",
      [first.id],
    );
    await learning[marketplace].checkOutcomes(60);
    assert.equal((await actions.get(first.id)).status, "SENDING");
    assert.equal(posts[marketplace], 0);
  });
}

for (const marketplace of ["HEPSIBURADA", "TRENDYOL"]) {
  test(`${marketplace}: two workers cannot resend the same action`, async () => {
    const first = (await generate(marketplace)).items[0];
    await approval.approve(first.id, "isolated-test");
    const results = await Promise.allSettled([
      executors[marketplace].apply(first.id, "worker-one"),
      executors[marketplace].apply(first.id, "worker-two"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(posts[marketplace], 1);
    assert.equal((await actions.get(first.id)).status, "AWAITING_RESULT");
  });
  test(`${marketplace}: concurrent workers see existing SKU barrier for same and different targets`, async () => {
    const first = await submitted(marketplace);
    const generated = await Promise.all([
      generate(marketplace, true),
      generate(marketplace),
    ]);
    assert.ok(generated.every((g) => g.created === 0));
    const candidates = await Promise.all(
      [0, 1].map((delta) =>
        actions.create({
          ...first,
          status: "APPROVED",
          proposed_price: Number(first.proposed_price) - delta,
          idempotency_key: `worker-${marketplace}-${delta}`,
          expires_at: new Date(Date.now() + 60000),
        }),
      ),
    );
    const attempts = await Promise.allSettled(
      candidates.map((a) => executors[marketplace].apply(a.id, "worker")),
    );
    assert.ok(
      attempts.every(
        (r) =>
          r.status === "rejected" && r.reason.code === "OPEN_ACTION_EXISTS",
      ),
    );
    assert.equal(posts[marketplace], 1);
  });
  test(`${marketplace}: concurrent 60m outcome checks do not duplicate learning`, async () => {
    const first = await submitted(marketplace);
    provider[marketplace].status = "SUCCESS";
    provider[marketplace].price = Number(first.proposed_price);
    await learning[marketplace].verifyPendingActions();
    await Promise.all([
      learning[marketplace].checkOutcomes(60),
      learning[marketplace].checkOutcomes(60),
    ]);
    const rows = (
      await db.query("SELECT * FROM price_change_outcomes WHERE action_id=$1", [
        first.id,
      ])
    ).rows;
    assert.equal(rows.length, 1);
    const learned = (
      await db.query(
        "SELECT failed_attempts FROM repricer_learning WHERE marketplace=$1 AND barcode='VERIFY'",
        [marketplace],
      )
    ).rows[0];
    assert.equal(learned.failed_attempts, 1);
    assert.equal((await actions.get(first.id)).status, "SUCCESS");
  });
  test(`${marketplace}: stale batch observations cannot confirm, fail or annotate another receipt`, async () => {
    const first = await submitted(marketplace);
    assert.equal(
      await actions.markVerificationFailed(
        first.id,
        "wrong batch",
        {},
        "STALE-BATCH",
      ),
      null,
    );
    assert.equal(
      await actions.recordVerificationPending(
        first.id,
        { status: "PENDING", error: "wrong batch" },
        "STALE-BATCH",
      ),
      null,
    );
    await assert.rejects(
      actions.confirmApplied(first.id, {
        marketProduct: { salePrice: first.proposed_price },
        expectedBatchId: "STALE-BATCH",
      }),
    );
    assert.equal((await actions.get(first.id)).status, "AWAITING_RESULT");
    assert.equal((await actions.get(first.id)).batch_id, first.batch_id);
  });
  test(`${marketplace}: overdue warning is durable and does not spam each poll`, async () => {
    const first = await submitted(marketplace);
    await learning[marketplace].verifyPendingActions();
    await learning[marketplace].verifyPendingActions();
    assert.equal(
      events.filter(
        (e) => e.operation === "PRICE_VERIFICATION_RECONCILIATION_REQUIRED",
      ).length,
      1,
    );
    const saved = await actions.get(first.id);
    assert.ok(saved.batch_checked_at);
    assert.match(saved.verification_error, /RECONCILIATION_REQUIRED/);
    assert.equal(saved.sent_at.getTime(), first.sent_at.getTime());
    assert.deepEqual(
      saved.api_response.dispatchReceipt,
      first.api_response.dispatchReceipt,
    );
  });
}
for (const kind of ["postError", "noReceipt"])
  test(`TRENDYOL: ${kind} remains SENDING through automatic job error handling`, async () => {
    const { createContainer } = require("../../src/container");
    const callbacks = new Map();
    provider.TRENDYOL[kind] = true;
    createContainer({
      db,
      actions,
      products,
      repricer,
      actionService: approval,
      trendyol: approval.trendyol,
      hepsiburadaActionService: executors.HEPSIBURADA,
      hepsiburada: executors.HEPSIBURADA.hepsiburada,
      learning: learning.TRENDYOL,
      hepsiburadaLearning: learning.HEPSIBURADA,
      jobService: {
        register: (name, callback) => callbacks.set(name, callback),
      },
    });
    const result = await callbacks.get("run-auto-repricer")();
    assert.equal(result.failed, 1);
    const first = (
      await db.query(
        "SELECT * FROM repricer_actions WHERE marketplace='TRENDYOL'",
      )
    ).rows[0];
    assert.equal(first.status, "SENDING");
    assert.equal(first.api_response.dispatch.outcome, "UNKNOWN");
    await callbacks.get("run-auto-repricer")();
    assert.equal((await actions.get(first.id)).status, "SENDING");
    assert.equal(posts.TRENDYOL, 1);
  });

test("real PostgreSQL exposes independent sessions and verification respects a held row lock", async (t) => {
  if (!raw.realPostgres)
    return t.diagnostic(
      "PGlite functional run only; multi-session evidence is in test:verification:postgres",
    );
  const first = await submitted("TRENDYOL");
  const one = await db.connect(),
    two = await db.connect();
  try {
    const pidOne = (await one.query("SELECT pg_backend_pid() pid")).rows[0].pid;
    const pidTwo = (await two.query("SELECT pg_backend_pid() pid")).rows[0].pid;
    assert.notEqual(pidOne, pidTwo);
    await one.query("BEGIN");
    await one.query("SELECT id FROM repricer_actions WHERE id=$1 FOR UPDATE", [
      first.id,
    ]);
    await two.query("BEGIN");
    await two.query("SET LOCAL lock_timeout='100ms'");
    await assert.rejects(
      two.query("SELECT id FROM repricer_actions WHERE id=$1 FOR UPDATE", [
        first.id,
      ]),
      (e) => e.code === "55P03",
    );
    console.log(
      JSON.stringify({
        realPostgres: true,
        independentPids: [pidOne, pidTwo],
        rowLockConflict: "55P03",
        actionId: first.id,
      }),
    );
  } finally {
    await one.query("ROLLBACK");
    await two.query("ROLLBACK");
    one.release();
    two.release();
  }
  await learning.TRENDYOL.verifyPendingActions();
  assert.equal((await actions.get(first.id)).status, "AWAITING_RESULT");
});

for (const marketplace of ["HEPSIBURADA", "TRENDYOL"]) {
  test(`${marketplace}: Buybox LOST is learning failure, price application stays SUCCESS`, async () => {
    const first = await submitted(marketplace);
    await db.query("UPDATE repricer_actions SET rank_before=1 WHERE id=$1", [
      first.id,
    ]);
    provider[marketplace].status = "SUCCESS";
    provider[marketplace].price = Number(first.proposed_price);
    await learning[marketplace].checkOutcomes(60);
    const outcome = (
      await db.query(
        "SELECT result FROM price_change_outcomes WHERE action_id=$1",
        [first.id],
      )
    ).rows[0];
    assert.equal(outcome.result, "BUYBOX_LOST");
    assert.equal((await actions.get(first.id)).status, "SUCCESS");
  });
  test(`${marketplace}: recent pending stays open without overdue warning`, async () => {
    const first = await submitted(marketplace, 5);
    await learning[marketplace].verifyPendingActions();
    const saved = await actions.get(first.id);
    assert.equal(saved.status, "AWAITING_RESULT");
    assert.equal(saved.verification_error, null);
    assert.equal(events.filter((e) => e.level === "WARN").length, 0);
  });
}

test("overdue unresolved actions rotate rather than starve newer verification receipts", async () => {
  const first = await submitted("TRENDYOL", 180);
  const second = await actions.create({
    ...first,
    barcode: "NEXT",
    idempotency_key: "next-receipt",
  });
  await actions.updateStatus(second.id, "AWAITING_RESULT", {
    batchId: "NEXT-BATCH",
  });
  assert.equal(
    (await actions.pendingVerifications(1, null, "TRENDYOL"))[0].id,
    first.id,
  );
  await actions.recordVerificationPending(
    first.id,
    { status: "PENDING" },
    first.batch_id,
  );
  assert.equal(
    (await actions.pendingVerifications(1, null, "TRENDYOL"))[0].id,
    second.id,
  );
});

test("HEPSIBURADA: another merchantSku on the same hbSku is not proof of applied price", async () => {
  const first = await submitted("HEPSIBURADA");
  provider.HEPSIBURADA.status = "SUCCESS";
  provider.HEPSIBURADA.price = Number(first.proposed_price);
  provider.HEPSIBURADA.wrongIdentity = true;
  await learning.HEPSIBURADA.verifyPendingActions();
  const saved = await actions.get(first.id);
  console.log(
    JSON.stringify({
      marketplace: "HEPSIBURADA",
      identity: "OTHER merchantSku / same hbSku",
      state: saved.status,
      verified: Boolean(saved.verified_at),
      mockPosts: posts.HEPSIBURADA,
    }),
  );
  assert.equal(saved.status, "AWAITING_RESULT");
  assert.equal(saved.verified_at, null);
  provider.HEPSIBURADA.wrongIdentity = false;
  await learning.HEPSIBURADA.verifyPendingActions();
  assert.equal((await actions.get(first.id)).status, "SUCCESS");
});

for (const marketplace of ["HEPSIBURADA", "TRENDYOL"]) {
  for (const operation of ["approve", "reject"])
    test(`${marketplace}: stale ${operation} snapshot cannot reopen/close a dispatched action`, async () => {
      const first = (await generate(marketplace)).items[0];
      if (operation === "reject")
        await approval.approve(first.id, "isolated-test");
      const get = actions.get.bind(actions);
      let once = true;
      actions.get = async (...args) => {
        const snapshot = await get(...args);
        if (once && String(args[0]) === String(first.id)) {
          once = false;
          if (operation === "approve")
            await actions.updateStatus(first.id, "APPROVED");
          await executors[marketplace].apply(first.id, "other-worker");
        }
        return snapshot;
      };
      await assert.rejects(
        approval[operation](first.id, "stale-worker"),
        (e) => e.code === "INVALID_ACTION_STATE",
      );
      assert.equal((await get(first.id)).status, "AWAITING_RESULT");
      assert.equal(posts[marketplace], 1);
    });
}

test("job failure compare-and-set cannot overwrite a newer dispatch state", async () => {
  const first = await submitted("TRENDYOL");
  const update = await actions.updateStatus(first.id, "FAILED", {
    expectedStatus: "APPROVED",
    error: "stale worker",
  });
  assert.equal(update, undefined);
  assert.equal((await actions.get(first.id)).status, "AWAITING_RESULT");
});
