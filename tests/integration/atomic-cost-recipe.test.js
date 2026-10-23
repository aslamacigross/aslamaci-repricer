const test = require("node:test");
const assert = require("node:assert/strict");
const { migrate } = require("../../src/db/migrate");
const { CostEngineService } = require("../../src/services/cost-engine.service");
const {
  CostIntegrityService,
} = require("../../src/services/cost-integrity.service");
const {
  ProductRepository,
} = require("../../src/repositories/product.repository");
const { createPglitePool } = require("../helpers/pglite-pool");

let idempotencySequence = 0;

async function setup({ failRecalculate = false, observe = null } = {}) {
  const raw = await createPglitePool();
  await migrate("up", raw);
  // Deterministic independent-reader/MVCC harness: readers see only the last
  // committed snapshot. PGlite itself is single-session, so reads during BEGIN
  // must not be mistaken for a separate PostgreSQL connection.
  let committed = [],
    inTransaction = false,
    queue = Promise.resolve();
  const queries = [];
  const db = {
    ...raw,
    query: async (sql, params) => {
      queries.push(sql);
      const result = await raw.query(sql, params);
      if (inTransaction && observe) observe(sql, committed);
      return result;
    },
  };
  const committedRows = () =>
    raw.query(
      "SELECT marketplace,barcode,calculated_product_cost,desi,data_complete FROM products ORDER BY marketplace,barcode",
    );
  const withTransaction = async (work) => {
    let release;
    const previous = queue;
    queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    committed = (await committedRows()).rows;
    inTransaction = true;
    const client = { query: db.query, release() {} };
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      committed = (await committedRows()).rows;
      observe?.("COMMITTED", committed);
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      inTransaction = false;
      release();
    }
  };
  const costEngine = failRecalculate
    ? {
        async recalculate() {
          throw new Error("forced multi-component recalculation failure");
        },
      }
    : new CostEngineService(db);
  return {
    db,
    queries,
    service: new CostIntegrityService({ db, withTransaction, costEngine }),
  };
}

async function addProduct(db, marketplace, barcode, override = null) {
  await db.query(
    `INSERT INTO products(
       marketplace,barcode,product_name,commission_rate,my_price,is_active,
       archived,manual_desi_override,service_fee,target_profit
     )VALUES($1,$2,$3,20,500,TRUE,FALSE,$4,10,40)`,
    [marketplace, barcode, `${barcode} product`, override],
  );
}

async function addItem(db, code, cost, unitDesi = 1) {
  return (
    await db.query(
      `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [code, `${code} physical product`, cost, unitDesi],
    )
  ).rows[0];
}

async function map(db, marketplace, barcode, item, quantity) {
  return (
    await db.query(
      `INSERT INTO product_cost_mappings(
         marketplace,barcode,cost_item_code,quantity
       )VALUES($1,$2,$3,$4) RETURNING *`,
      [marketplace, barcode, item.item_code, quantity],
    )
  ).rows[0];
}

async function addLiveOffer(db, sourceKey, cost, supplier = "BIM") {
  return (
    await db.query(
      `INSERT INTO file_market_items(
         source_key,product_name,normalized_name,current_price,supplier_code,
         availability,offer_type,checked_at,last_seen_at
       )VALUES($1,$2,$3,$4,$5,'AVAILABLE','LIVE',NOW(),NOW()) RETURNING *`,
      [
        sourceKey,
        `${sourceKey} physical product`,
        sourceKey.toLowerCase(),
        cost,
        supplier,
      ],
    )
  ).rows[0];
}

function applyInput(preview, key) {
  idempotencySequence += 1;
  return {
    operationType: preview.operationType,
    payload: preview.payload,
    previewFingerprint: preview.previewFingerprint,
    confirmedMappingCount: preview.impact.mappingCount,
    idempotencyKey: key || `multi-component-${idempotencySequence}`,
    actor: "phase-2c3-test",
    reason: "multi-component recipe test",
  };
}

async function recipe(db, marketplace, barcode) {
  return (
    await db.query(
      `SELECT pcm.*,ci.id AS cost_item_id,ci.unit_cost,ci.unit_desi
       FROM product_cost_mappings pcm
       JOIN cost_items ci ON ci.item_code=pcm.cost_item_code
       WHERE pcm.marketplace=$1 AND pcm.barcode=$2 ORDER BY pcm.id`,
      [marketplace, barcode],
    )
  ).rows;
}

const TYPE = "REPLACE_PRODUCT_COST_RECIPE";
const component = (item, quantity) => ({
  costItemId: Number(item.id),
  quantity,
});
async function fixture(t, options = {}) {
  const setupResult = await setup(options);
  const { db } = setupResult;
  t.after(() => db.end());
  const penne = await addItem(db, "PENNE", 75, 0.3);
  const fusilli = await addItem(db, "FUSILLI", 69, 0.4);
  const third = await addItem(db, "THIRD", 10, 0.2);
  await addProduct(db, "TRENDYOL", "ATOMIC");
  return { ...setupResult, penne, fusilli, third };
}
async function preview(service, components, marketplace = "TRENDYOL") {
  return service.preview(TYPE, { marketplace, barcode: "ATOMIC", components });
}

test("atomic single, three-component, quantity/replace/remove and multi-to-single recipes", async (t) => {
  const { db, service, penne, fusilli, third } = await fixture(t);
  for (const components of [
    [component(penne, 3)],
    [component(penne, 2), component(fusilli, 1), component(third, 3)],
    [component(penne, 4), component(third, 2)],
    [component(fusilli, 3)],
  ]) {
    const plan = await preview(service, components);
    const op = await service.apply(applyInput(plan));
    assert.equal(op.operation_type, TYPE);
    assert.deepEqual(
      (await recipe(db, "TRENDYOL", "ATOMIC")).map((row) => [
        Number(row.cost_item_id),
        Number(row.quantity),
      ]),
      components.map((row) => [row.costItemId, row.quantity]),
    );
    const product = (
      await db.query(
        "SELECT calculated_product_cost,desi FROM products WHERE barcode='ATOMIC'",
      )
    ).rows[0];
    assert.equal(
      Number(product.calculated_product_cost),
      plan.impact.proposedTotals.cost,
    );
    assert.equal(
      Number(product.desi),
      plan.impact.proposedTotals.effectiveDesi,
    );
  }
});

test("3 Penne 225 -> 2 Penne + Fusilli 219: independent committed reader never observes 150", async (t) => {
  const observations = [];
  const { db, service, penne, fusilli } = await fixture(t, {
    observe: (sql, rows) => {
      observations.push({
        sql,
        cost: Number(
          rows.find((row) => row.barcode === "ATOMIC")?.calculated_product_cost,
        ),
      });
    },
  });
  await map(db, "TRENDYOL", "ATOMIC", penne, 3);
  await new CostEngineService(db).recalculate("ATOMIC", db, "TRENDYOL");
  const plan = await preview(service, [
    component(penne, 2),
    component(fusilli, 1),
  ]);
  assert.equal(plan.impact.currentTotals.cost, 225);
  assert.equal(plan.impact.proposedTotals.cost, 219);
  await service.apply(applyInput(plan));
  assert(
    observations.some((row) =>
      row.sql.startsWith("DELETE FROM product_cost_mappings"),
    ),
  );
  assert(
    observations.some((row) =>
      row.sql.includes("INSERT INTO product_cost_mappings"),
    ),
  );
  assert(
    observations
      .filter((row) => row.sql !== "COMMITTED")
      .every((row) => row.cost === 225),
  );
  assert.equal(observations.at(-1).cost, 219);
  assert(!observations.some((row) => row.cost === 150));
});

test("initial two-component recipe remains unmapped to committed reader until one commit", async (t) => {
  const observations = [];
  const { db, service, penne, fusilli } = await fixture(t, {
    observe: (sql, rows) => observations.push({ sql, ...rows[0] }),
  });
  await service.apply(
    applyInput(
      await preview(service, [component(penne, 2), component(fusilli, 1)]),
    ),
  );
  assert(
    observations.some((row) =>
      row.sql.includes(
        "FROM products WHERE marketplace=$1 AND barcode=$2 FOR UPDATE",
      ),
    ),
  );
  assert(
    observations
      .filter((row) => row.sql !== "COMMITTED")
      .every((row) => Number(row.calculated_product_cost) === 0),
  );
  assert.equal(Number(observations.at(-1).calculated_product_cost), 219);
  assert.equal((await recipe(db, "TRENDYOL", "ATOMIC")).length, 2);
});

test("preview is read only, LIVE canonical creation and manual creation commit atomically; whole recipe undo cleans creations", async (t) => {
  const { db, service, penne, queries } = await fixture(t);
  const offer = await addLiveOffer(db, "UNLINKED", 69);
  const components = [
    component(penne, 2),
    { supplierOfferId: Number(offer.id), quantity: 1, unitDesi: 0.4 },
    {
      itemCode: "MANUAL_ATOMIC",
      itemName: "Manual physical",
      unitCost: 10,
      unitDesi: 1,
      physicalSupplierCode: "OTHER",
      checkedAt: new Date().toISOString(),
      quantity: 2,
    },
  ];
  const count = async () =>
    (
      await db.query(
        "SELECT (SELECT COUNT(*) FROM cost_items) items,(SELECT COUNT(*) FROM product_cost_mappings) mappings,(SELECT COUNT(*) FROM cost_integrity_operations) operations",
      )
    ).rows[0];
  const before = await count();
  const queryStart = queries.length;
  const plan = await preview(service, components);
  assert(queries.slice(queryStart).every((sql) => /^\s*SELECT\b/i.test(sql)));
  assert.deepEqual(await count(), before);
  const op = await service.apply(applyInput(plan));
  assert.equal((await recipe(db, "TRENDYOL", "ATOMIC")).length, 3);
  await service.reverse(op.id, {
    actor: "test",
    reason: "undo recipe",
    idempotencyKey: "undo-create-recipe",
  });
  assert.equal((await recipe(db, "TRENDYOL", "ATOMIC")).length, 0);
  assert.equal(Number((await count()).items), Number(before.items));
  assert.equal(
    (await db.query("SELECT id FROM file_market_items WHERE id=$1", [offer.id]))
      .rowCount,
    1,
  );
});

test("failed final recalculation rolls back recipe, LIVE canonical, manual offer and audit together", async (t) => {
  const { db, service, penne } = await fixture(t, { failRecalculate: true });
  await map(db, "TRENDYOL", "ATOMIC", penne, 3);
  const offer = await addLiveOffer(db, "ROLLBACK_LIVE", 69);
  const plan = await preview(service, [
    component(penne, 2),
    { supplierOfferId: Number(offer.id), quantity: 1, unitDesi: 1 },
    {
      itemCode: "ROLLBACK_MANUAL",
      itemName: "Manual rollback",
      unitCost: 1,
      unitDesi: 1,
      quantity: 1,
      physicalSupplierCode: "OTHER",
      checkedAt: new Date().toISOString(),
    },
  ]);
  await assert.rejects(service.apply(applyInput(plan)), /forced/);
  assert.deepEqual(
    (await recipe(db, "TRENDYOL", "ATOMIC")).map((row) => [
      row.cost_item_code,
      Number(row.quantity),
    ]),
    [["PENNE", 3]],
  );
  assert.equal(
    (
      await db.query(
        "SELECT id FROM cost_item_supplier_offers WHERE supplier_offer_id=$1",
        [offer.id],
      )
    ).rowCount,
    0,
  );
  assert.equal((await db.query("SELECT id FROM cost_items")).rowCount, 3);
  assert.equal(
    (await db.query("SELECT id FROM cost_integrity_operations")).rowCount,
    0,
  );
});

test("competing whole-recipe applies serialize and stale loser cannot overwrite winner", async (t) => {
  const { db, service, penne, fusilli } = await fixture(t);
  const first = await preview(service, [component(penne, 3)]);
  const second = await preview(service, [component(fusilli, 2)]);
  const results = await Promise.allSettled([
    service.apply(applyInput(first)),
    service.apply(applyInput(second)),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(
    results.find((row) => row.status === "rejected").reason.code,
    "STALE_PREVIEW",
  );
  assert.equal(
    (await recipe(db, "TRENDYOL", "ATOMIC"))[0].cost_item_code,
    "PENNE",
  );
});

test("idempotent double submission performs one full recipe and one canonical creation", async (t) => {
  const { db, service, penne } = await fixture(t);
  const offer = await addLiveOffer(db, "DOUBLE", 69);
  const plan = await preview(service, [
    component(penne, 2),
    { supplierOfferId: Number(offer.id), quantity: 1 },
  ]);
  const input = applyInput(plan, "atomic-double");
  const [first, second] = await Promise.all([
    service.apply(input),
    service.apply(input),
  ]);
  assert.equal(first.id, second.id);
  assert.equal((await recipe(db, "TRENDYOL", "ATOMIC")).length, 2);
  assert.equal(
    (
      await db.query(
        "SELECT id FROM cost_item_supplier_offers WHERE supplier_offer_id=$1",
        [offer.id],
      )
    ).rowCount,
    1,
  );
});

test("supplier/canonical price changes invalidate preview", async (t) => {
  const { db, service, penne } = await fixture(t);
  const plan = await preview(service, [component(penne, 3)]);
  await db.query("UPDATE cost_items SET unit_cost=80 WHERE id=$1", [penne.id]);
  await assert.rejects(
    service.apply(applyInput(plan)),
    (error) => error.code === "STALE_PREVIEW",
  );
  const offer = await addLiveOffer(db, "STALE_SOURCE", 69);
  const live = await preview(service, [
    { supplierOfferId: Number(offer.id), quantity: 2 },
  ]);
  await db.query("UPDATE file_market_items SET current_price=70 WHERE id=$1", [
    offer.id,
  ]);
  await assert.rejects(
    service.apply(applyInput(live)),
    (error) => error.code === "STALE_PREVIEW",
  );
});

test("whole recipe undo restores exact old recipe and blocks later independent edits", async (t) => {
  const { db, service, penne, fusilli } = await fixture(t);
  const old = await map(db, "TRENDYOL", "ATOMIC", penne, 3);
  const op = await service.apply(
    applyInput(
      await preview(service, [component(penne, 2), component(fusilli, 1)]),
    ),
  );
  await service.reverse(op.id, {
    actor: "test",
    reason: "restore",
    idempotencyKey: "undo-full",
  });
  const restored = await recipe(db, "TRENDYOL", "ATOMIC");
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, old.id);
  assert.equal(Number(restored[0].quantity), 3);
  const next = await service.apply(
    applyInput(
      await preview(service, [component(penne, 2), component(fusilli, 1)]),
    ),
  );
  await service.apply(
    applyInput(await preview(service, [component(penne, 4)])),
  );
  await assert.rejects(
    service.reverse(next.id, {
      actor: "test",
      reason: "unsafe",
      idempotencyKey: "undo-unsafe",
    }),
    (error) => error.code === "COST_OPERATION_NOT_REVERSIBLE",
  );
});

test("empty, duplicate canonical/offer and invalid physical quantities rejected", async (t) => {
  const { db, service, penne } = await fixture(t);
  for (const quantity of [undefined, null, "", "abc", 1.5, 0, -1])
    await assert.rejects(
      preview(service, [component(penne, quantity)]),
      (error) => error.code === "VALIDATION_ERROR",
    );
  await assert.rejects(
    preview(service, []),
    (error) => error.code === "VALIDATION_ERROR",
  );
  await assert.rejects(
    preview(service, [component(penne, 1), component(penne, 2)]),
    (error) => error.code === "TARGET_MAPPING_EXISTS",
  );
  const offer = await addLiveOffer(db, "DUP", 69);
  await assert.rejects(
    preview(service, [
      { supplierOfferId: Number(offer.id), quantity: 1 },
      { supplierOfferId: Number(offer.id), quantity: 2 },
    ]),
    (error) => error.code === "TARGET_MAPPING_EXISTS",
  );
});

test("BIZIM quantity tier, breakdown, desi override and TY/HB isolation", async (t) => {
  const { db, service, penne, fusilli } = await fixture(t);
  const offer = await addLiveOffer(db, "TIER", 75, "BIZIM_MARKET");
  await db.query(
    "UPDATE file_market_items SET price_tiers=$2::jsonb WHERE id=$1",
    [
      offer.id,
      JSON.stringify([{ min_quantity: 2, max_quantity: null, unit_price: 60 }]),
    ],
  );
  await db.query(
    "INSERT INTO cost_item_supplier_offers(cost_item_id,supplier_offer_id,status,is_selected,approved_by,approved_at,selected_by,selected_at,selection_reason) VALUES($1,$2,'APPROVED',TRUE,'test',NOW(),'test',NOW(),'test')",
    [penne.id, offer.id],
  );
  await addProduct(db, "HEPSIBURADA", "ATOMIC", 8);
  const hbMapping = await map(db, "HEPSIBURADA", "ATOMIC", penne, 3);
  await db.query(
    "UPDATE products SET manual_desi_override=7 WHERE marketplace='TRENDYOL' AND barcode='ATOMIC'",
  );
  const plan = await preview(service, [
    component(penne, 2),
    component(fusilli, 1),
  ]);
  await service.apply(applyInput(plan));
  const breakdown = await new ProductRepository(db).breakdown(
    "ATOMIC",
    "TRENDYOL",
  );
  assert.equal(Number(breakdown.product.calculated_product_cost), 189);
  assert.equal(Number(breakdown.product.desi), 7);
  assert.equal(
    Number(
      breakdown.mappings.find((row) => row.cost_item_code === "PENNE")
        .unit_cost,
    ),
    60,
  );
  assert.equal((await recipe(db, "HEPSIBURADA", "ATOMIC"))[0].id, hbMapping.id);
});

test("preview desi uses exact NUMERIC aggregation at an integer rounding boundary", async (t) => {
  const { db, service, penne, fusilli, third } = await fixture(t);
  await db.query("UPDATE cost_items SET unit_desi=0.1 WHERE id=$1", [penne.id]);
  await db.query("UPDATE cost_items SET unit_desi=0.2 WHERE id=$1", [
    fusilli.id,
  ]);
  await db.query("UPDATE cost_items SET unit_desi=0.7 WHERE id=$1", [third.id]);
  const plan = await preview(service, [
    component(penne, 1),
    component(fusilli, 1),
    component(third, 1),
  ]);
  assert.equal(plan.impact.proposedTotals.effectiveDesi, 1);
  const op = await service.apply(applyInput(plan));
  assert.equal(Number(op.after_snapshot.product.desi), 1);
});

test("restoring a removed component is blocked if its canonical source changed later", async (t) => {
  const { db, service, penne, fusilli } = await fixture(t);
  await map(db, "TRENDYOL", "ATOMIC", penne, 2);
  await map(db, "TRENDYOL", "ATOMIC", fusilli, 1);
  const op = await service.apply(
    applyInput(await preview(service, [component(penne, 2)])),
  );
  await db.query("UPDATE cost_items SET unit_cost=99 WHERE id=$1", [
    fusilli.id,
  ]);
  await assert.rejects(
    service.reverse(op.id, {
      actor: "test",
      reason: "unsafe",
      idempotencyKey: "removed-source-changed",
    }),
    (error) => error.code === "COST_OPERATION_NOT_REVERSIBLE",
  );
});

test("fingerprints preserve PostgreSQL Date values across JSON audit serialization", () => {
  const { fingerprint } = require("../../src/services/cost-integrity.service");
  const input = { checked_at: new Date("2026-10-24T00:00:00Z") };
  assert.equal(
    fingerprint(input),
    fingerprint(JSON.parse(JSON.stringify(input))),
  );
  assert.notEqual(
    fingerprint(input),
    fingerprint({ checked_at: new Date("2026-10-24T00:00:01Z") }),
  );
});
