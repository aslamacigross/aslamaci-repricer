const test = require("node:test");
const assert = require("node:assert/strict");
const { migrate } = require("../../src/db/migrate");
const { createPglitePool } = require("../helpers/pglite-pool");
const {
  CostIntegrityService,
} = require("../../src/services/cost-integrity.service");
const {
  MappingAutomationRepository,
} = require("../../src/repositories/mapping-automation.repository");
const {
  CanonicalCostRepository,
} = require("../../src/repositories/canonical-cost.repository");

async function fixture({ recalculate } = {}) {
  const db = await createPglitePool();
  await migrate("up", db);
  const withTransaction = async (work) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  const recalculations = [];
  const service = new CostIntegrityService({
    db,
    withTransaction,
    costEngine: {
      async recalculate(barcode, client, marketplace) {
        recalculations.push({ barcode, marketplace });
        if (recalculate) return recalculate(barcode, client, marketplace);
        return { processed: 1 };
      },
    },
  });
  return {
    db,
    service,
    recalculations,
    withTransaction,
    canonical: new CanonicalCostRepository(db, withTransaction),
  };
}

async function addCostItem(db, code, unitCost = 100) {
  return (
    await db.query(
      `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
       VALUES($1,$2,$3,1) RETURNING *`,
      [code, `${code} item`, unitCost],
    )
  ).rows[0];
}

async function addOffer(
  db,
  key,
  price,
  { supplier = "BIM", type = "LIVE", availability = "AVAILABLE" } = {},
) {
  return (
    await db.query(
      `INSERT INTO file_market_items(
         source_key,product_name,normalized_name,current_price,supplier_code,
         availability,offer_type,physical_supplier_code,checked_at
       )VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
      [
        key,
        `${key} product`,
        key.toLowerCase(),
        price,
        supplier,
        availability,
        type,
        type === "MANUAL" ? supplier : null,
      ],
    )
  ).rows[0];
}

async function linkOffer(
  db,
  item,
  offer,
  { selected = false, status = "APPROVED" } = {},
) {
  return (
    await db.query(
      `INSERT INTO cost_item_supplier_offers(
         cost_item_id,supplier_offer_id,status,is_selected,approved_by,approved_at,
         selected_by,selected_at,selection_reason
       )VALUES($1,$2,$3,$4,'tester',NOW(),
         CASE WHEN $4 THEN 'tester' ELSE NULL END,
         CASE WHEN $4 THEN NOW() ELSE NULL END,
         CASE WHEN $4 THEN 'fixture' ELSE NULL END)
       RETURNING *`,
      [item.id, offer.id, status, selected],
    )
  ).rows[0];
}

async function addLegacyLink(db, item, offer) {
  return (
    await db.query(
      `INSERT INTO cost_item_file_links(
         cost_item_code,file_market_item_id,confidence,status,approved_by,approved_at
       )VALUES($1,$2,1,'APPROVED','tester',NOW()) RETURNING *`,
      [item.item_code, offer.id],
    )
  ).rows[0];
}

async function addProductMapping(db, item, marketplace, barcode, quantity = 1) {
  await db.query(
    `INSERT INTO products(
       marketplace,barcode,product_name,commission_rate,my_price,is_active,archived
     )VALUES($1,$2,$3,20,200,TRUE,FALSE)`,
    [marketplace, barcode, `${barcode} product`],
  );
  return (
    await db.query(
      `INSERT INTO product_cost_mappings(
         marketplace,barcode,cost_item_code,quantity
       )VALUES($1,$2,$3,$4) RETURNING *`,
      [marketplace, barcode, item.item_code, quantity],
    )
  ).rows[0];
}

function applyInput(preview, overrides = {}) {
  return {
    operationType: preview.operationType,
    payload: preview.payload,
    previewFingerprint: preview.previewFingerprint,
    confirmedMappingCount: preview.impact.mappingCount,
    idempotencyKey: `test-${cryptoRandom()}`,
    actor: "phase-2b-test",
    reason: "explicit test confirmation",
    ...overrides,
  };
}

let sequence = 0;
function cryptoRandom() {
  sequence += 1;
  return sequence;
}

test("legacy link canonical backfill dry-run ve apply davranisi", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.end());
  const safeItem = await addCostItem(db, "LEGACY_SAFE", 123);
  const safeOffer = await addOffer(db, "LEGACY-SAFE", 99);
  await db.query(
    `INSERT INTO cost_item_file_links(
       cost_item_code,file_market_item_id,status,approved_by,approved_at
     )VALUES($1,$2,'APPROVED','tester',NOW())`,
    [safeItem.item_code, safeOffer.id],
  );
  const parallel = await addOffer(db, "LEGACY-PARALLEL", 90);
  for (const code of ["LEGACY_PARALLEL_A", "LEGACY_PARALLEL_B"]) {
    const item = await addCostItem(db, code, 88);
    await db.query(
      `INSERT INTO cost_item_file_links(
         cost_item_code,file_market_item_id,status,approved_by,approved_at
       )VALUES($1,$2,'APPROVED','tester',NOW())`,
      [item.item_code, parallel.id],
    );
  }

  const preview = await service.legacyBackfillPreview();
  assert.equal(preview.counts.total, 3);
  assert.equal(preview.counts.safe, 1);
  assert.equal(preview.counts.parallel, 2);
  assert.equal(
    Number(
      (
        await db.query("SELECT unit_cost FROM cost_items WHERE id=$1", [
          safeItem.id,
        ])
      ).rows[0].unit_cost,
    ),
    123,
  );

  const applied = await service.applyLegacyBackfill({
    actor: "phase-2b-test",
    reason: "fixture backfill",
    idempotencyKey: "legacy-backfill-1",
    previewFingerprint: preview.previewFingerprint,
    confirmedSafeCount: 1,
  });
  assert.equal(applied.status, "APPLIED");
  const relations = await db.query(
    "SELECT * FROM cost_item_supplier_offers ORDER BY id",
  );
  assert.equal(relations.rowCount, 1);
  assert.equal(relations.rows[0].is_selected, true);
  assert.equal(Number(relations.rows[0].cost_item_id), Number(safeItem.id));
  assert.equal(
    Number(
      (
        await db.query("SELECT unit_cost FROM cost_items WHERE id=$1", [
          safeItem.id,
        ])
      ).rows[0].unit_cost,
    ),
    123,
  );
});

test("selected offer degisimi atomic, audited ve idempotenttir", async (t) => {
  const { db, service, recalculations } = await fixture();
  t.after(() => db.end());
  const item = await addCostItem(db, "SELECTED_ATOMIC", 100);
  const oldOffer = await addOffer(db, "SELECTED-OLD", 100);
  const newOffer = await addOffer(db, "SELECTED-NEW", 110);
  await linkOffer(db, item, oldOffer, { selected: true });
  await linkOffer(db, item, newOffer);
  await addLegacyLink(db, item, oldOffer);
  await addProductMapping(db, item, "TRENDYOL", "SELECTED-TY");
  await addProductMapping(db, item, "HEPSIBURADA", "SELECTED-HB");
  await db.query(
    `UPDATE product_cost_mappings
     SET effective_unit_cost=80,supplier_price_tier='{"min_quantity":2}'::jsonb
     WHERE marketplace='TRENDYOL' AND barcode='SELECTED-TY'`,
  );

  const preview = await service.preview("CHANGE_SELECTED_OFFER", {
    costItemId: item.id,
    targetSupplierOfferId: newOffer.id,
  });
  assert.equal(preview.impact.mappingCount, 2);
  assert.equal(preview.impact.byMarketplace.TRENDYOL, 1);
  assert.equal(preview.impact.byMarketplace.HEPSIBURADA, 1);
  const input = applyInput(preview, { idempotencyKey: "selected-atomic" });
  const first = await service.apply(input);
  const second = await service.apply(input);
  assert.equal(Number(first.id), Number(second.id));
  const updated = (
    await db.query(
      "SELECT unit_cost,previous_unit_cost FROM cost_items WHERE id=$1",
      [item.id],
    )
  ).rows[0];
  assert.equal(Number(updated.unit_cost), 110);
  assert.equal(Number(updated.previous_unit_cost), 100);
  const tierReset = (
    await db.query(
      `SELECT effective_unit_cost,supplier_price_tier
       FROM product_cost_mappings
       WHERE marketplace='TRENDYOL' AND barcode='SELECTED-TY'`,
    )
  ).rows[0];
  assert.equal(tierReset.effective_unit_cost, null);
  assert.equal(tierReset.supplier_price_tier, null);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT file_market_item_id FROM cost_item_file_links WHERE cost_item_code=$1",
          [item.item_code],
        )
      ).rows[0].file_market_item_id,
    ),
    Number(newOffer.id),
  );
  assert.deepEqual(
    recalculations.sort((a, b) => a.marketplace.localeCompare(b.marketplace)),
    [
      { barcode: "SELECTED-HB", marketplace: "HEPSIBURADA" },
      { barcode: "SELECTED-TY", marketplace: "TRENDYOL" },
    ],
  );
  assert.equal(
    (
      await db.query(
        "SELECT COUNT(*)::int count FROM cost_integrity_operations",
      )
    ).rows[0].count,
    1,
  );
});

test("CostEngine hatasi selected offer ve unit cost islemini rollback eder", async (t) => {
  const { db, service } = await fixture({
    recalculate: async () => {
      throw new Error("forced recalculation failure");
    },
  });
  t.after(() => db.end());
  const item = await addCostItem(db, "ROLLBACK_ATOMIC", 50);
  const oldOffer = await addOffer(db, "ROLLBACK-OLD", 50);
  const target = await addOffer(db, "ROLLBACK-NEW", 75);
  await linkOffer(db, item, oldOffer, { selected: true });
  await linkOffer(db, item, target);
  await addLegacyLink(db, item, oldOffer);
  await addProductMapping(db, item, "TRENDYOL", "ROLLBACK-TY");
  const preview = await service.preview("CHANGE_SELECTED_OFFER", {
    costItemId: item.id,
    targetSupplierOfferId: target.id,
  });
  await assert.rejects(
    service.apply(applyInput(preview)),
    /forced recalculation/,
  );
  const unchanged = (
    await db.query("SELECT unit_cost FROM cost_items WHERE id=$1", [item.id])
  ).rows[0];
  assert.equal(Number(unchanged.unit_cost), 50);
  const selected = (
    await db.query(
      "SELECT supplier_offer_id FROM cost_item_supplier_offers WHERE cost_item_id=$1 AND is_selected=TRUE",
      [item.id],
    )
  ).rows[0];
  assert.equal(Number(selected.supplier_offer_id), Number(oldOffer.id));
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT file_market_item_id FROM cost_item_file_links WHERE cost_item_code=$1",
          [item.item_code],
        )
      ).rows[0].file_market_item_id,
    ),
    Number(oldOffer.id),
  );
  assert.equal(
    (
      await db.query(
        "SELECT COUNT(*)::int count FROM cost_integrity_operations",
      )
    ).rows[0].count,
    0,
  );
});

test("direct mapping reassign marketplace izolasyonunu korur ve geri alinabilir", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.end());
  const source = await addCostItem(db, "SHARED_SOURCE", 40);
  const target = await addCostItem(db, "TY_TARGET", 55);
  await addProductMapping(db, source, "TRENDYOL", "SHARED-BARCODE", 2);
  await addProductMapping(db, source, "HEPSIBURADA", "SHARED-BARCODE", 3);
  const preview = await service.preview("REASSIGN_PRODUCT_COST", {
    marketplace: "TRENDYOL",
    barcode: "SHARED-BARCODE",
    sourceCostItemId: source.id,
    targetCostItemId: target.id,
    quantity: 2,
  });
  const operation = await service.apply(applyInput(preview));
  let mappings = await db.query(
    `SELECT marketplace,cost_item_code,quantity FROM product_cost_mappings
     WHERE barcode='SHARED-BARCODE' ORDER BY marketplace`,
  );
  assert.deepEqual(
    mappings.rows.map((row) => [
      row.marketplace,
      row.cost_item_code,
      Number(row.quantity),
    ]),
    [
      ["HEPSIBURADA", "SHARED_SOURCE", 3],
      ["TRENDYOL", "TY_TARGET", 2],
    ],
  );
  await service.reverse(operation.id, {
    actor: "phase-2b-test",
    reason: "undo mapping correction",
    idempotencyKey: "reverse-reassign",
  });
  mappings = await db.query(
    `SELECT marketplace,cost_item_code FROM product_cost_mappings
     WHERE barcode='SHARED-BARCODE' ORDER BY marketplace`,
  );
  assert.equal(mappings.rows[0].cost_item_code, "SHARED_SOURCE");
  assert.equal(mappings.rows[1].cost_item_code, "SHARED_SOURCE");
});

test("1-to-1 replace tum mappingleri tasir ve kaynak item'i archive eder", async (t) => {
  const { db, service, canonical } = await fixture();
  t.after(() => db.end());
  const source = await addCostItem(db, "REPLACE_OLD", 65);
  const target = await addCostItem(db, "REPLACE_NEW", 79);
  await addProductMapping(db, source, "TRENDYOL", "MR-GREEN-TY");
  await addProductMapping(db, source, "HEPSIBURADA", "MR-GREEN-HB");
  const preview = await service.preview("REPLACE_COST_ITEM", {
    sourceCostItemId: source.id,
    targetCostItemId: target.id,
  });
  assert.equal(preview.impact.mappingCount, 2);
  await service.apply(applyInput(preview));
  const moved = await db.query(
    "SELECT DISTINCT cost_item_code FROM product_cost_mappings WHERE barcode LIKE 'MR-GREEN-%'",
  );
  assert.deepEqual(
    moved.rows.map((row) => row.cost_item_code),
    ["REPLACE_NEW"],
  );
  const archived = (
    await db.query("SELECT lifecycle_status FROM cost_items WHERE id=$1", [
      source.id,
    ])
  ).rows[0];
  assert.equal(archived.lifecycle_status, "ARCHIVED");
  const alias = (
    await db.query(
      "SELECT canonical_cost_item_id,status FROM cost_item_aliases WHERE alias_code=$1",
      [source.item_code],
    )
  ).rows[0];
  assert.equal(Number(alias.canonical_cost_item_id), Number(target.id));
  assert.equal(alias.status, "ACTIVE");
  const resolved = await canonical.resolveCostItemIdentity(source.item_code);
  assert.equal(Number(resolved.id), Number(target.id));
  assert.equal(resolved.resolution_source, "ALIAS");
});

test("1-to-N split tum mappingleri tam kapsar ve bundle quantity korur", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.end());
  const source = await addCostItem(db, "RED_LENTIL_PASTA", 25);
  const fusilli = await addCostItem(db, "FUSILLI_240G", 28);
  const penne = await addCostItem(db, "PENNE_240G", 29);
  const first = await addProductMapping(
    db,
    source,
    "TRENDYOL",
    "FUSILLI-X2",
    2,
  );
  const second = await addProductMapping(
    db,
    source,
    "HEPSIBURADA",
    "PENNE-X3",
    3,
  );
  await assert.rejects(
    service.preview("SPLIT_COST_MAPPINGS", {
      sourceCostItemId: source.id,
      assignments: [{ mappingId: first.id, targetCostItemId: fusilli.id }],
    }),
    (error) => error.code === "INCOMPLETE_SPLIT",
  );
  const preview = await service.preview("SPLIT_COST_MAPPINGS", {
    sourceCostItemId: source.id,
    assignments: [
      { mappingId: first.id, targetCostItemId: fusilli.id },
      { mappingId: second.id, targetCostItemId: penne.id },
    ],
  });
  assert.deepEqual(
    preview.impact.assignments.map((row) => [row.barcode, row.quantity]),
    [
      ["FUSILLI-X2", 2],
      ["PENNE-X3", 3],
    ],
  );
  await service.apply(applyInput(preview));
  const moved = await db.query(
    `SELECT barcode,cost_item_code,quantity FROM product_cost_mappings
     WHERE barcode IN('FUSILLI-X2','PENNE-X3') ORDER BY barcode`,
  );
  assert.deepEqual(
    moved.rows.map((row) => [
      row.barcode,
      row.cost_item_code,
      Number(row.quantity),
    ]),
    [
      ["FUSILLI-X2", "FUSILLI_240G", 2],
      ["PENNE-X3", "PENNE_240G", 3],
    ],
  );
});

test("manual-to-live user confirmation ile secimi ve maliyeti degistirir", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.end());
  const item = await addCostItem(db, "HARRAS_TEA_MANUAL", 239);
  const manual = await addOffer(db, "MANUAL-HARRAS", 239, {
    supplier: "FILE_MARKET",
    type: "MANUAL",
  });
  const live = await addOffer(db, "LIVE-HARRAS", 241, {
    supplier: "FILE_MARKET",
  });
  await linkOffer(db, item, manual, { selected: true });
  const preview = await service.preview("MANUAL_TO_LIVE", {
    costItemId: item.id,
    targetSupplierOfferId: live.id,
  });
  assert.equal(
    Number(
      (
        await db.query("SELECT unit_cost FROM cost_items WHERE id=$1", [
          item.id,
        ])
      ).rows[0].unit_cost,
    ),
    239,
  );
  await service.apply(applyInput(preview));
  const relations = await db.query(
    `SELECT supplier_offer_id,status,is_selected FROM cost_item_supplier_offers
     WHERE cost_item_id=$1 ORDER BY supplier_offer_id`,
    [item.id],
  );
  assert.equal(
    relations.rows.find(
      (row) => Number(row.supplier_offer_id) === Number(manual.id),
    ).status,
    "ARCHIVED",
  );
  assert.equal(
    relations.rows.find(
      (row) => Number(row.supplier_offer_id) === Number(live.id),
    ).is_selected,
    true,
  );
  assert.equal(
    Number(
      (
        await db.query("SELECT unit_cost FROM cost_items WHERE id=$1", [
          item.id,
        ])
      ).rows[0].unit_cost,
    ),
    241,
  );
});

test("supplier replacement preview mutation yapmaz, apply user confirmation gerektirir", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.end());
  const item = await addCostItem(db, "MR_GREEN", 65);
  const oldOffer = await addOffer(db, "MR-GREEN-OLD", 65, {
    availability: "UNAVAILABLE",
  });
  const newOffer = await addOffer(db, "MR-GREEN-NEW", 79);
  await linkOffer(db, item, oldOffer, { selected: true });
  await addLegacyLink(db, item, oldOffer);
  const preview = await service.preview("REPLACE_SUPPLIER_OFFER", {
    costItemId: item.id,
    oldSupplierOfferId: oldOffer.id,
    newSupplierOfferId: newOffer.id,
  });
  assert.equal(
    Number(
      (
        await db.query("SELECT unit_cost FROM cost_items WHERE id=$1", [
          item.id,
        ])
      ).rows[0].unit_cost,
    ),
    65,
  );
  const operation = await service.apply(applyInput(preview));
  assert.equal(
    Number(
      (
        await db.query("SELECT unit_cost FROM cost_items WHERE id=$1", [
          item.id,
        ])
      ).rows[0].unit_cost,
    ),
    79,
  );
  const relation = (
    await db.query(
      "SELECT status FROM supplier_offer_relations WHERE from_supplier_offer_id=$1",
      [oldOffer.id],
    )
  ).rows[0];
  assert.equal(relation.status, "APPROVED");
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT file_market_item_id FROM cost_item_file_links WHERE cost_item_code=$1",
          [item.item_code],
        )
      ).rows[0].file_market_item_id,
    ),
    Number(newOffer.id),
  );
  await service.reverse(operation.id, {
    actor: "phase-2b-test",
    reason: "replacement was incorrect",
    idempotencyKey: "reverse-replacement",
  });
  assert.equal(
    Number(
      (
        await db.query("SELECT unit_cost FROM cost_items WHERE id=$1", [
          item.id,
        ])
      ).rows[0].unit_cost,
    ),
    65,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT file_market_item_id FROM cost_item_file_links WHERE cost_item_code=$1",
          [item.item_code],
        )
      ).rows[0].file_market_item_id,
    ),
    Number(oldOffer.id),
  );
});

test("archive ve hard-delete eligibility guardlari guvenlidir", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.end());
  const inUse = await addCostItem(db, "ARCHIVE_IN_USE", 20);
  await addProductMapping(db, inUse, "TRENDYOL", "ARCHIVE-USED");
  const archivePreview = await service.preview("ARCHIVE_COST_ITEM", {
    costItemId: inUse.id,
  });
  await assert.rejects(
    service.apply(applyInput(archivePreview)),
    (error) => error.code === "COST_ITEM_IN_USE",
  );
  const unused = await addCostItem(db, "ARCHIVE_UNUSED", 20);
  const unusedPreview = await service.preview("ARCHIVE_COST_ITEM", {
    costItemId: unused.id,
  });
  const archived = await service.apply(applyInput(unusedPreview));
  assert.equal(archived.status, "APPLIED");
  assert.equal(
    (
      await db.query("SELECT lifecycle_status FROM cost_items WHERE id=$1", [
        unused.id,
      ])
    ).rows[0].lifecycle_status,
    "ARCHIVED",
  );

  const safeDelete = await addCostItem(db, "DELETE_UNUSED", 10);
  const eligibility = await service.hardDeleteEligibility(safeDelete.id);
  assert.equal(eligibility.eligible, true);
  const deletePreview = await service.preview("HARD_DELETE_COST_ITEM", {
    costItemId: safeDelete.id,
  });
  await service.apply(applyInput(deletePreview));
  assert.equal(
    (await db.query("SELECT 1 FROM cost_items WHERE id=$1", [safeDelete.id]))
      .rowCount,
    0,
  );
  const usedEligibility = await service.hardDeleteEligibility(inUse.id);
  assert.equal(usedEligibility.eligible, false);
});

test("stale preview apply edilmez", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.end());
  const item = await addCostItem(db, "STALE_ITEM", 100);
  const first = await addOffer(db, "STALE-1", 100);
  const second = await addOffer(db, "STALE-2", 120);
  await linkOffer(db, item, first, { selected: true });
  await linkOffer(db, item, second);
  const preview = await service.preview("CHANGE_SELECTED_OFFER", {
    costItemId: item.id,
    targetSupplierOfferId: second.id,
  });
  await db.query("UPDATE file_market_items SET current_price=121 WHERE id=$1", [
    second.id,
  ]);
  await assert.rejects(
    service.apply(applyInput(preview)),
    (error) => error.code === "STALE_PREVIEW",
  );
  assert.equal(
    Number(
      (
        await db.query("SELECT unit_cost FROM cost_items WHERE id=$1", [
          item.id,
        ])
      ).rows[0].unit_cost,
    ),
    100,
  );
});

test("orphan repair ve quarantine previewlari kanitli kayit gerektirir", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.end());
  await db.query(
    "ALTER TABLE product_cost_mappings DROP CONSTRAINT product_cost_mappings_cost_item_code_fk",
  );
  const orphan = (
    await db.query(
      `INSERT INTO product_cost_mappings(
         marketplace,barcode,cost_item_code,quantity
       )VALUES('TRENDYOL','ORPHAN-BARCODE','MISSING-COST',1) RETURNING *`,
    )
  ).rows[0];
  const target = await addCostItem(db, "ORPHAN_REPAIR_TARGET", 75);
  const repair = await service.preview("REPAIR_ORPHAN", {
    sourceTable: "PRODUCT_COST_MAPPINGS",
    sourceRowId: orphan.id,
    targetCostItemId: target.id,
  });
  assert.deepEqual(repair.warnings, ["ORPHAN_RECORD"]);
  assert.equal(repair.impact.mappingCount, 1);
  const quarantine = await service.preview("QUARANTINE_ORPHAN", {
    sourceTable: "PRODUCT_COST_MAPPINGS",
    sourceRowId: orphan.id,
  });
  assert.equal(quarantine.target.id, Number(orphan.id));
  const quarantined = await service.apply(applyInput(quarantine));
  assert.equal(
    (
      await db.query(
        "SELECT COUNT(*)::int count FROM product_cost_mappings WHERE id=$1",
        [orphan.id],
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT status FROM cost_integrity_quarantine WHERE source_row_id=$1",
        [orphan.id],
      )
    ).rows[0].status,
    "QUARANTINED",
  );
  await service.reverse(quarantined.id, {
    actor: "phase-2b-test",
    reason: "restore orphan visibility",
    idempotencyKey: "reverse-orphan-quarantine",
  });
  assert.equal(
    (
      await db.query(
        "SELECT status FROM cost_integrity_quarantine WHERE source_row_id=$1",
        [orphan.id],
      )
    ).rows[0].status,
    "RESTORED",
  );
});

test("eski supplier duplicate merge canonical relation varken durur", async (t) => {
  const { db, withTransaction } = await fixture();
  t.after(() => db.end());
  const item = await addCostItem(db, "MERGE_GUARD", 50);
  const first = await addOffer(db, "MERGE-GUARD-1", 50);
  const second = await addOffer(db, "MERGE-GUARD-2", 50);
  await db.query(
    "UPDATE file_market_items SET normalized_name='same product' WHERE id=ANY($1::bigint[])",
    [[first.id, second.id]],
  );
  await linkOffer(db, item, first, { selected: true });
  const repository = new MappingAutomationRepository(db, withTransaction);
  await assert.rejects(
    repository.mergeSupplierDuplicateGroup("BIM", "same product"),
    (error) => error.code === "CANONICAL_SUPPLIER_RELATION_CONFLICT",
  );
  const unchanged = await db.query(
    "SELECT availability FROM file_market_items WHERE id=ANY($1::bigint[]) ORDER BY id",
    [[first.id, second.id]],
  );
  assert.equal(
    unchanged.rows.every((row) => row.availability === "AVAILABLE"),
    true,
  );
});

test("manual cost create preview, atomic apply ve reversal canonical state'i korur", async (t) => {
  const { db, service, recalculations } = await fixture();
  t.after(() => db.end());
  const source = await addCostItem(db, "MANUAL_CREATE_SOURCE", 55);
  const mapping = await addProductMapping(
    db,
    source,
    "TRENDYOL",
    "MANUAL-CREATE-TY",
    2,
  );
  const preview = await service.preview("CREATE_MANUAL_COST", {
    marketplace: "TRENDYOL",
    barcode: "MANUAL-CREATE-TY",
    sourceCostItemId: source.id,
    itemCode: "MANUAL_CREATED_SAFE",
    itemName: "Manuel test ürünü",
    unitCost: 79,
    unitDesi: 1.2,
    quantity: 2,
    physicalSupplierCode: "FILE_MARKET",
    checkedAt: "2026-09-19",
  });
  assert.equal(preview.impact.targetUnitCost, 79);
  assert.equal(preview.impact.mappingCount, 1);
  const applied = await service.apply(applyInput(preview));
  const created = (
    await db.query("SELECT * FROM cost_items WHERE item_code='MANUAL_CREATED_SAFE'")
  ).rows[0];
  const relation = (
    await db.query(
      "SELECT * FROM cost_item_supplier_offers WHERE cost_item_id=$1",
      [created.id],
    )
  ).rows[0];
  const offer = (
    await db.query("SELECT * FROM file_market_items WHERE id=$1", [
      relation.supplier_offer_id,
    ])
  ).rows[0];
  const moved = (
    await db.query("SELECT * FROM product_cost_mappings WHERE id=$1", [mapping.id])
  ).rows[0];
  assert.equal(offer.offer_type, "MANUAL");
  assert.equal(offer.physical_supplier_code, "FILE_MARKET");
  assert.equal(relation.is_selected, true);
  assert.equal(moved.cost_item_code, "MANUAL_CREATED_SAFE");
  assert.deepEqual(recalculations, [
    { barcode: "MANUAL-CREATE-TY", marketplace: "TRENDYOL" },
  ]);

  await service.reverse(applied.id, {
    actor: "phase-2c-test",
    reason: "manual create undo",
    idempotencyKey: "manual-create-reversal",
  });
  assert.equal(
    (
      await db.query(
        "SELECT COUNT(*)::int count FROM cost_items WHERE item_code='MANUAL_CREATED_SAFE'",
      )
    ).rows[0].count,
    0,
  );
  assert.equal(
    (
      await db.query("SELECT cost_item_code FROM product_cost_mappings WHERE id=$1", [
        mapping.id,
      ])
    ).rows[0].cost_item_code,
    source.item_code,
  );
});

test("manual cost edit fiyat ve metadata'yi atomic günceller ve geri alır", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.end());
  const item = await addCostItem(db, "MANUAL_EDIT_SAFE", 65);
  const offer = await addOffer(db, "MANUAL-EDIT-SAFE", 65, {
    supplier: "OTHER",
    type: "MANUAL",
  });
  await db.query(
    "UPDATE file_market_items SET physical_supplier_code='BIM',checked_at='2026-08-01' WHERE id=$1",
    [offer.id],
  );
  await linkOffer(db, item, offer, { selected: true });
  await addLegacyLink(db, item, offer);
  await addProductMapping(db, item, "HEPSIBURADA", "MANUAL-EDIT-HB");
  const preview = await service.preview("EDIT_MANUAL_COST", {
    costItemId: item.id,
    supplierOfferId: offer.id,
    itemName: "Güncel manuel ürün",
    unitCost: 79,
    physicalSupplierCode: "BIM",
    checkedAt: "2026-09-19",
  });
  const applied = await service.apply(applyInput(preview));
  const edited = (
    await db.query("SELECT item_name,unit_cost FROM cost_items WHERE id=$1", [item.id])
  ).rows[0];
  assert.equal(edited.item_name, "Güncel manuel ürün");
  assert.equal(Number(edited.unit_cost), 79);
  assert.equal(
    Number(
      (
        await db.query("SELECT current_price FROM file_market_items WHERE id=$1", [
          offer.id,
        ])
      ).rows[0].current_price,
    ),
    79,
  );
  await service.reverse(applied.id, {
    actor: "phase-2c-test",
    reason: "manual edit undo",
    idempotencyKey: "manual-edit-reversal",
  });
  const restored = (
    await db.query("SELECT item_name,unit_cost FROM cost_items WHERE id=$1", [item.id])
  ).rows[0];
  assert.equal(restored.item_name, item.item_name);
  assert.equal(Number(restored.unit_cost), 65);
});

test("supplier selector server-side search canonical ve selected bilgiyi döndürür", async (t) => {
  const { db, service, withTransaction } = await fixture();
  t.after(() => db.end());
  const item = await addCostItem(db, "SELECTOR_CANONICAL", 59.9);
  const offer = await addOffer(db, "FILE-SELECTOR-KEY", 59.9, {
    supplier: "FILE_MARKET",
  });
  await db.query(
    `UPDATE file_market_items
     SET raw_data='{"barcode":"8690000000001"}'::jsonb WHERE id=$1`,
    [offer.id],
  );
  await linkOffer(db, item, offer, { selected: true });
  const repository = new MappingAutomationRepository(db, withTransaction);
  const result = await repository.listSupplierItems({
    supplierCode: "FILE_MARKET",
    search: "8690000000001",
    page: 1,
    limit: 20,
  });
  assert.equal(result.total, 1);
  assert.equal(Number(result.items[0].canonical_cost_item_id), Number(item.id));
  assert.equal(result.items[0].canonical_item_code, item.item_code);
  assert.equal(result.items[0].is_selected, true);

  const costItems = await service.searchCostItems({ search: "", page: 1, limit: 20 });
  assert.ok(costItems.total >= 1);
  assert.ok(costItems.items.some((row) => Number(row.id) === Number(item.id)));
});

test("mappingi olmayan ürün canonical cost item'a atanır ve geri alınır", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.end());
  const item = await addCostItem(db, "UNMAPPED_ASSIGN", 88);
  await db.query(
    `INSERT INTO products(
       marketplace,barcode,product_name,commission_rate,my_price,is_active,archived
     )VALUES('HEPSIBURADA','UNMAPPED-HB','Unmapped HB',20,200,TRUE,FALSE)`,
  );
  const preview = await service.preview("ASSIGN_PRODUCT_COST", {
    marketplace: "HEPSIBURADA",
    barcode: "UNMAPPED-HB",
    targetCostItemId: item.id,
    quantity: 3,
  });
  assert.equal(preview.impact.byMarketplace.HEPSIBURADA, 1);
  const applied = await service.apply(applyInput(preview));
  const mapping = (
    await db.query(
      "SELECT * FROM product_cost_mappings WHERE marketplace='HEPSIBURADA' AND barcode='UNMAPPED-HB'",
    )
  ).rows[0];
  assert.equal(mapping.cost_item_code, item.item_code);
  assert.equal(Number(mapping.quantity), 3);
  await service.reverse(applied.id, {
    actor: "phase-2c-test",
    reason: "assign undo",
    idempotencyKey: "assign-reversal",
  });
  assert.equal(
    (
      await db.query(
        "SELECT COUNT(*)::int count FROM product_cost_mappings WHERE marketplace='HEPSIBURADA' AND barcode='UNMAPPED-HB'",
      )
    ).rows[0].count,
    0,
  );
});
