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

async function setup({ failRecalculate = false } = {}) {
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
  const costEngine = failRecalculate
    ? {
        async recalculate() {
          throw new Error("forced multi-component recalculation failure");
        },
      }
    : new CostEngineService(db);
  return {
    db,
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

test("Penne x3 ve karisik uc bileşenli reçeteler maliyet/desiyi toplar ve reload edilir", async (t) => {
  const { db } = await setup();
  t.after(() => db.end());
  const penne69 = await addItem(db, "PENNE_69", 69, 0.3);
  const penne75 = await addItem(db, "PENNE_75", 75, 0.3);
  const fusilli = await addItem(db, "FUSILLI", 69, 0.4);
  const macaroni = await addItem(db, "MACARONI", 10, 0.2);
  await addProduct(db, "TRENDYOL", "harrasmercimekpenne3");
  await addProduct(db, "TRENDYOL", "MIXED-3", 7);
  await map(db, "TRENDYOL", "harrasmercimekpenne3", penne69, 3);
  await map(db, "TRENDYOL", "MIXED-3", penne75, 2);
  await map(db, "TRENDYOL", "MIXED-3", fusilli, 1);
  await map(db, "TRENDYOL", "MIXED-3", macaroni, 3);

  const engine = new CostEngineService(db);
  await engine.recalculate("harrasmercimekpenne3", db, "TRENDYOL");
  await engine.recalculate("MIXED-3", db, "TRENDYOL");
  const penneProduct = (
    await db.query(
      `SELECT calculated_product_cost,desi FROM products
       WHERE marketplace='TRENDYOL' AND barcode='harrasmercimekpenne3'`,
    )
  ).rows[0];
  assert.equal(Number(penneProduct.calculated_product_cost), 207);
  assert.equal(Number(penneProduct.desi), 1);
  const mixedProduct = (
    await db.query(
      `SELECT calculated_product_cost,desi FROM products
       WHERE marketplace='TRENDYOL' AND barcode='MIXED-3'`,
    )
  ).rows[0];
  assert.equal(Number(mixedProduct.calculated_product_cost), 249);
  assert.equal(Number(mixedProduct.desi), 7);
  const breakdown = await new ProductRepository(db).breakdown(
    "MIXED-3",
    "TRENDYOL",
  );
  assert.deepEqual(
    breakdown.mappings.map((row) => [row.cost_item_code, Number(row.quantity)]),
    [
      ["FUSILLI", 1],
      ["MACARONI", 3],
      ["PENNE_75", 2],
    ],
  );
});

test("Penne x2 + Fusilli x1 = 219 ve tek bileşenli mevcut mapping değişmeden kalır", async (t) => {
  const { db } = await setup();
  t.after(() => db.end());
  const penne = await addItem(db, "PENNE", 75, 0.3);
  const fusilli = await addItem(db, "FUSILLI", 69, 0.4);
  await addProduct(db, "TRENDYOL", "MIXED-219");
  await addProduct(db, "TRENDYOL", "SINGLE");
  await map(db, "TRENDYOL", "MIXED-219", penne, 2);
  await map(db, "TRENDYOL", "MIXED-219", fusilli, 1);
  const single = await map(db, "TRENDYOL", "SINGLE", penne, 3);
  const engine = new CostEngineService(db);
  await engine.recalculate("MIXED-219", db, "TRENDYOL");
  await engine.recalculate("SINGLE", db, "TRENDYOL");
  const rows = await db.query(
    `SELECT barcode,calculated_product_cost FROM products
     WHERE marketplace='TRENDYOL' AND barcode=ANY($1::text[]) ORDER BY barcode`,
    [["MIXED-219", "SINGLE"]],
  );
  assert.deepEqual(
    rows.rows.map((row) => [row.barcode, Number(row.calculated_product_cost)]),
    [
      ["MIXED-219", 219],
      ["SINGLE", 225],
    ],
  );
  const unchanged = (
    await db.query("SELECT * FROM product_cost_mappings WHERE id=$1", [
      single.id,
    ])
  ).rows[0];
  assert.equal(Number(unchanged.quantity), 3);
  assert.equal(unchanged.cost_item_code, "PENNE");
});

test("component add, quantity, replace, middle remove ve undo yalnız hedef satırı değiştirir", async (t) => {
  const { db, service } = await setup();
  t.after(() => db.end());
  const penne = await addItem(db, "PENNE", 75);
  const fusilli = await addItem(db, "FUSILLI", 69);
  const macaroni = await addItem(db, "MACARONI", 80);
  await addProduct(db, "TRENDYOL", "RECIPE");
  const first = await map(db, "TRENDYOL", "RECIPE", penne, 2);

  const addPreview = await service.preview("ASSIGN_PRODUCT_COST", {
    marketplace: "TRENDYOL",
    barcode: "RECIPE",
    targetCostItemId: fusilli.id,
    quantity: 1,
  });
  assert.equal(addPreview.impact.recipeCurrentCost, 150);
  assert.equal(addPreview.impact.recipeTargetCost, 219);
  assert.equal(addPreview.impact.targetEffectiveProductDesi, 3);
  const addOperation = await service.apply(
    applyInput(addPreview, "add-fusilli-once"),
  );
  const repeated = await service.apply(
    applyInput(addPreview, "add-fusilli-once"),
  );
  assert.equal(Number(repeated.id), Number(addOperation.id));
  let rows = await recipe(db, "TRENDYOL", "RECIPE");
  assert.equal(rows.length, 2);
  const fusilliMapping = rows.find((row) => row.cost_item_code === "FUSILLI");

  const quantityPreview = await service.preview("REASSIGN_PRODUCT_COST", {
    marketplace: "TRENDYOL",
    barcode: "RECIPE",
    sourceCostItemId: fusilli.id,
    targetCostItemId: fusilli.id,
    quantity: 3,
  });
  await service.apply(applyInput(quantityPreview));
  rows = await recipe(db, "TRENDYOL", "RECIPE");
  assert.equal(
    Number(rows.find((row) => row.id === fusilliMapping.id).quantity),
    3,
  );
  assert.equal(Number(rows.find((row) => row.id === first.id).quantity), 2);
  await assert.rejects(
    service.reverse(addOperation.id, {
      actor: "phase-2c3-test",
      reason: "later edit must block add undo",
      idempotencyKey: "unsafe-add-undo",
    }),
    (error) => error.code === "COST_OPERATION_NOT_REVERSIBLE",
  );

  const replacePreview = await service.preview("REASSIGN_PRODUCT_COST", {
    marketplace: "TRENDYOL",
    barcode: "RECIPE",
    sourceCostItemId: fusilli.id,
    targetCostItemId: macaroni.id,
    quantity: 3,
  });
  await service.apply(applyInput(replacePreview));
  rows = await recipe(db, "TRENDYOL", "RECIPE");
  assert.deepEqual(
    rows.map((row) => [row.cost_item_code, Number(row.quantity)]),
    [
      ["PENNE", 2],
      ["MACARONI", 3],
    ],
  );

  const removePreview = await service.preview("REMOVE_PRODUCT_COST_COMPONENT", {
    marketplace: "TRENDYOL",
    barcode: "RECIPE",
    mappingId: rows.find((row) => row.cost_item_code === "MACARONI").id,
  });
  const removeOperation = await service.apply(applyInput(removePreview));
  assert.deepEqual(
    (await recipe(db, "TRENDYOL", "RECIPE")).map((row) => row.cost_item_code),
    ["PENNE"],
  );
  await service.reverse(removeOperation.id, {
    actor: "phase-2c3-test",
    reason: "restore removed middle component",
    idempotencyKey: "undo-component-removal",
  });
  assert.deepEqual(
    (await recipe(db, "TRENDYOL", "RECIPE")).map((row) => row.cost_item_code),
    ["PENNE", "MACARONI"],
  );
});

test("component replace kaynak effective maliyetini taşımaz ve hedef quantity kademesini kullanır", async (t) => {
  const { db, service } = await setup();
  t.after(() => db.end());
  const penne = await addItem(db, "PENNE_TIER_GUARD", 75);
  const source = await addItem(db, "SOURCE_TIER_GUARD", 50);
  const target = await addItem(db, "TARGET_TIER_GUARD", 100);
  const offer = await addLiveOffer(
    db,
    "BIZIM-TARGET-TIER",
    100,
    "BIZIM_MARKET",
  );
  await db.query(
    `UPDATE file_market_items
     SET price_tiers='[{"min_quantity":3,"unit_price":80}]'::jsonb
     WHERE id=$1`,
    [offer.id],
  );
  await db.query(
    `INSERT INTO cost_item_supplier_offers(
       cost_item_id,supplier_offer_id,status,is_selected,approved_by,approved_at,
       selected_by,selected_at,selection_reason
     )VALUES($1,$2,'APPROVED',TRUE,'test',NOW(),'test',NOW(),'fixture')`,
    [target.id, offer.id],
  );
  await addProduct(db, "TRENDYOL", "TIER-REPLACE");
  const penneMapping = await map(db, "TRENDYOL", "TIER-REPLACE", penne, 2);
  const sourceMapping = await map(db, "TRENDYOL", "TIER-REPLACE", source, 1);
  await db.query(
    `UPDATE product_cost_mappings
     SET effective_unit_cost=42,
         supplier_price_tier='{"min_quantity":2,"unit_price":42}'::jsonb
     WHERE id=$1`,
    [sourceMapping.id],
  );

  const preview = await service.preview("REASSIGN_PRODUCT_COST", {
    marketplace: "TRENDYOL",
    barcode: "TIER-REPLACE",
    sourceCostItemId: source.id,
    targetCostItemId: target.id,
    quantity: 3,
  });
  assert.equal(preview.impact.targetUnitCost, 80);
  assert.equal(preview.impact.recipeCurrentCost, 192);
  assert.equal(preview.impact.recipeTargetCost, 390);
  const applied = await service.apply(
    applyInput(preview, "replace-with-target-tier"),
  );
  let rows = await recipe(db, "TRENDYOL", "TIER-REPLACE");
  const replaced = rows.find((row) => row.id === sourceMapping.id);
  assert.equal(replaced.cost_item_code, "TARGET_TIER_GUARD");
  assert.equal(Number(replaced.quantity), 3);
  assert.equal(Number(replaced.effective_unit_cost), 80);
  assert.equal(Number(replaced.supplier_price_tier.min_quantity), 3);
  assert.equal(
    rows.find((row) => row.id === penneMapping.id).cost_item_code,
    "PENNE_TIER_GUARD",
  );

  await service.reverse(applied.id, {
    actor: "phase-2c3-test",
    reason: "restore source tier mapping",
    idempotencyKey: "replace-with-target-tier-undo",
  });
  rows = await recipe(db, "TRENDYOL", "TIER-REPLACE");
  const restored = rows.find((row) => row.id === sourceMapping.id);
  assert.equal(restored.cost_item_code, "SOURCE_TIER_GUARD");
  assert.equal(Number(restored.effective_unit_cost), 42);
  assert.equal(Number(restored.supplier_price_tier.min_quantity), 2);
});

test("unlinked LIVE teklif mevcut reçeteye ikinci canonical bileşen olarak eklenir ve güvenle geri alınır", async (t) => {
  const { db, service } = await setup();
  t.after(() => db.end());
  const penne = await addItem(db, "PENNE", 75);
  const offer = await addLiveOffer(db, "BIM-FUSILLI-240", 69);
  await addProduct(db, "TRENDYOL", "LIVE-ADD");
  const penneMapping = await map(db, "TRENDYOL", "LIVE-ADD", penne, 2);

  const preview = await service.preview(
    "CREATE_COST_ITEM_FROM_OFFER_AND_ASSIGN",
    {
      marketplace: "TRENDYOL",
      barcode: "LIVE-ADD",
      supplierOfferId: offer.id,
      itemName: "Fusilli 240 g",
      unitDesi: 0.4,
      quantity: 1,
      addToRecipe: true,
    },
  );
  assert.equal(preview.impact.createsCanonicalCostItem, true);
  assert.equal(preview.payload.addToRecipe, true);
  const applied = await service.apply(
    applyInput(preview, "live-add-to-recipe"),
  );
  let rows = await recipe(db, "TRENDYOL", "LIVE-ADD");
  assert.equal(rows.length, 2);
  assert.equal(
    Number(rows.find((row) => row.id === penneMapping.id).quantity),
    2,
  );
  assert.equal(
    Number(rows.find((row) => row.cost_item_code !== "PENNE").quantity),
    1,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT calculated_product_cost FROM products WHERE marketplace='TRENDYOL' AND barcode='LIVE-ADD'",
        )
      ).rows[0].calculated_product_cost,
    ),
    219,
  );

  await service.reverse(applied.id, {
    actor: "phase-2c3-test",
    reason: "remove newly created live component",
    idempotencyKey: "live-add-to-recipe-undo",
  });
  rows = await recipe(db, "TRENDYOL", "LIVE-ADD");
  assert.deepEqual(
    rows.map((row) => [row.cost_item_code, Number(row.quantity)]),
    [["PENNE", 2]],
  );
  assert.equal(
    (
      await db.query(
        "SELECT COUNT(*)::int count FROM cost_item_supplier_offers WHERE supplier_offer_id=$1",
        [offer.id],
      )
    ).rows[0].count,
    0,
  );
});

test("unlinked LIVE teklif yalnız seçilen componenti yeni canonical ile değiştirir", async (t) => {
  const { db, service } = await setup();
  t.after(() => db.end());
  const penne = await addItem(db, "PENNE_LIVE_REPLACE", 75);
  const fusilli = await addItem(db, "FUSILLI_LIVE_REPLACE", 69);
  const offer = await addLiveOffer(db, "BIM-MACARONI-240", 80);
  await addProduct(db, "TRENDYOL", "LIVE-REPLACE");
  const penneMapping = await map(db, "TRENDYOL", "LIVE-REPLACE", penne, 2);
  const fusilliMapping = await map(db, "TRENDYOL", "LIVE-REPLACE", fusilli, 1);

  const preview = await service.preview(
    "CREATE_COST_ITEM_FROM_OFFER_AND_ASSIGN",
    {
      marketplace: "TRENDYOL",
      barcode: "LIVE-REPLACE",
      sourceCostItemId: fusilli.id,
      supplierOfferId: offer.id,
      itemName: "Macaroni 240 g",
      unitDesi: 0.2,
      quantity: 1,
    },
  );
  assert.equal(preview.impact.recipeCurrentCost, 219);
  assert.equal(preview.impact.recipeTargetCost, 230);
  const applied = await service.apply(
    applyInput(preview, "live-replace-component"),
  );
  let rows = await recipe(db, "TRENDYOL", "LIVE-REPLACE");
  assert.equal(rows.length, 2);
  assert.equal(
    rows.find((row) => row.id === penneMapping.id).cost_item_code,
    "PENNE_LIVE_REPLACE",
  );
  assert.notEqual(
    rows.find((row) => row.id === fusilliMapping.id).cost_item_code,
    "FUSILLI_LIVE_REPLACE",
  );

  await service.reverse(applied.id, {
    actor: "phase-2c3-test",
    reason: "restore replaced live component",
    idempotencyKey: "live-replace-component-undo",
  });
  rows = await recipe(db, "TRENDYOL", "LIVE-REPLACE");
  assert.deepEqual(
    rows.map((row) => [row.cost_item_code, Number(row.quantity)]),
    [
      ["PENNE_LIVE_REPLACE", 2],
      ["FUSILLI_LIVE_REPLACE", 1],
    ],
  );
});

test("Diğer/manual akışı mevcut reçeteye bağımsız component ekler ve undo ilgisiz satırı korur", async (t) => {
  const { db, service } = await setup();
  t.after(() => db.end());
  const penne = await addItem(db, "PENNE_MANUAL_ADD", 75);
  await addProduct(db, "TRENDYOL", "MANUAL-ADD");
  const penneMapping = await map(db, "TRENDYOL", "MANUAL-ADD", penne, 2);

  const preview = await service.preview("CREATE_MANUAL_COST", {
    marketplace: "TRENDYOL",
    barcode: "MANUAL-ADD",
    addToRecipe: true,
    itemCode: "MANUAL_FUSILLI_240",
    itemName: "Manual Fusilli 240 g",
    unitCost: 69,
    unitDesi: 0.4,
    quantity: 1,
    physicalSupplierCode: "FILE_MARKET",
    checkedAt: "2026-10-22T00:00:00.000Z",
  });
  assert.equal(preview.impact.recipeCurrentCost, 150);
  assert.equal(preview.impact.recipeTargetCost, 219);
  const applied = await service.apply(
    applyInput(preview, "manual-add-component"),
  );
  let rows = await recipe(db, "TRENDYOL", "MANUAL-ADD");
  assert.deepEqual(
    rows.map((row) => [row.cost_item_code, Number(row.quantity)]),
    [
      ["PENNE_MANUAL_ADD", 2],
      ["MANUAL_FUSILLI_240", 1],
    ],
  );

  await service.reverse(applied.id, {
    actor: "phase-2c3-test",
    reason: "remove manual component",
    idempotencyKey: "manual-add-component-undo",
  });
  rows = await recipe(db, "TRENDYOL", "MANUAL-ADD");
  assert.deepEqual(
    rows.map((row) => [row.id, row.cost_item_code, Number(row.quantity)]),
    [[penneMapping.id, "PENNE_MANUAL_ADD", 2]],
  );
});

test("duplicate, son bileşen, kesir/sıfır/negatif ve stale preview güvenle reddedilir", async (t) => {
  const { db, service } = await setup();
  t.after(() => db.end());
  const penne = await addItem(db, "PENNE", 69);
  const fusilli = await addItem(db, "FUSILLI", 69);
  await addProduct(db, "TRENDYOL", "GUARDS");
  const penneMapping = await map(db, "TRENDYOL", "GUARDS", penne, 1);
  for (const quantity of [1.5, 0, -1, "missing"]) {
    await assert.rejects(
      service.preview("REASSIGN_PRODUCT_COST", {
        marketplace: "TRENDYOL",
        barcode: "GUARDS",
        sourceCostItemId: penne.id,
        targetCostItemId: penne.id,
        quantity,
      }),
      (error) => error.code === "VALIDATION_ERROR",
    );
  }
  await assert.rejects(
    service.preview("ASSIGN_PRODUCT_COST", {
      marketplace: "TRENDYOL",
      barcode: "GUARDS",
      targetCostItemId: penne.id,
      quantity: 1,
    }),
    (error) => error.code === "TARGET_MAPPING_EXISTS",
  );
  await assert.rejects(
    service.preview("REMOVE_PRODUCT_COST_COMPONENT", {
      marketplace: "TRENDYOL",
      barcode: "GUARDS",
      mappingId: penneMapping.id,
    }),
    (error) => error.code === "LAST_PRODUCT_COST_COMPONENT",
  );
  const stale = await service.preview("ASSIGN_PRODUCT_COST", {
    marketplace: "TRENDYOL",
    barcode: "GUARDS",
    targetCostItemId: fusilli.id,
    quantity: 1,
  });
  await db.query("UPDATE product_cost_mappings SET quantity=2 WHERE id=$1", [
    penneMapping.id,
  ]);
  await assert.rejects(
    service.apply(applyInput(stale)),
    (error) => error.code === "STALE_PREVIEW",
  );
  assert.equal((await recipe(db, "TRENDYOL", "GUARDS")).length, 1);
});

test("eşzamanlı add yarışı duplicate üretmez ve marketplace mappingleri izole kalır", async (t) => {
  const { db, service } = await setup();
  t.after(() => db.end());
  const penne = await addItem(db, "PENNE", 75);
  const fusilli = await addItem(db, "FUSILLI", 69);
  await addProduct(db, "TRENDYOL", "SHARED");
  await addProduct(db, "HEPSIBURADA", "SHARED");
  await map(db, "TRENDYOL", "SHARED", penne, 2);
  await map(db, "HEPSIBURADA", "SHARED", penne, 4);
  const first = await service.preview("ASSIGN_PRODUCT_COST", {
    marketplace: "TRENDYOL",
    barcode: "SHARED",
    targetCostItemId: fusilli.id,
    quantity: 1,
  });
  const concurrent = await service.preview("ASSIGN_PRODUCT_COST", {
    marketplace: "TRENDYOL",
    barcode: "SHARED",
    targetCostItemId: fusilli.id,
    quantity: 1,
  });
  await service.apply(applyInput(first));
  await assert.rejects(
    service.apply(applyInput(concurrent)),
    (error) =>
      error.code === "TARGET_MAPPING_EXISTS" || error.code === "STALE_PREVIEW",
  );
  assert.deepEqual(
    (await recipe(db, "TRENDYOL", "SHARED")).map((row) => row.cost_item_code),
    ["PENNE", "FUSILLI"],
  );
  assert.deepEqual(
    (await recipe(db, "HEPSIBURADA", "SHARED")).map((row) => [
      row.cost_item_code,
      Number(row.quantity),
    ]),
    [["PENNE", 4]],
  );
});

test("recalculate hatası bütün component add işlemini rollback eder", async (t) => {
  const { db, service } = await setup({ failRecalculate: true });
  t.after(() => db.end());
  const penne = await addItem(db, "PENNE", 75);
  const fusilli = await addItem(db, "FUSILLI", 69);
  await addProduct(db, "TRENDYOL", "ROLLBACK-RECIPE");
  await map(db, "TRENDYOL", "ROLLBACK-RECIPE", penne, 2);
  const preview = await service.preview("ASSIGN_PRODUCT_COST", {
    marketplace: "TRENDYOL",
    barcode: "ROLLBACK-RECIPE",
    targetCostItemId: fusilli.id,
    quantity: 1,
  });
  await assert.rejects(
    service.apply(applyInput(preview)),
    /forced multi-component recalculation failure/,
  );
  assert.deepEqual(
    (await recipe(db, "TRENDYOL", "ROLLBACK-RECIPE")).map((row) => [
      row.cost_item_code,
      Number(row.quantity),
    ]),
    [["PENNE", 2]],
  );
});

test("ürün breakdown ve CostEngine mapping effective maliyetini aynı şekilde toplar", async (t) => {
  const { db } = await setup();
  t.after(() => db.end());
  const penne = await addItem(db, "PENNE_EFFECTIVE", 75, 0.3);
  const fusilli = await addItem(db, "FUSILLI_EFFECTIVE", 69, 0.4);
  await addProduct(db, "TRENDYOL", "EFFECTIVE-RECIPE");
  await map(db, "TRENDYOL", "EFFECTIVE-RECIPE", penne, 2);
  const fusilliMapping = await map(
    db,
    "TRENDYOL",
    "EFFECTIVE-RECIPE",
    fusilli,
    1,
  );
  await db.query(
    "UPDATE product_cost_mappings SET effective_unit_cost=60 WHERE id=$1",
    [fusilliMapping.id],
  );

  await new CostEngineService(db).recalculate(
    "EFFECTIVE-RECIPE",
    db,
    "TRENDYOL",
  );
  const breakdown = await new ProductRepository(db).breakdown(
    "EFFECTIVE-RECIPE",
    "TRENDYOL",
  );
  const effective = breakdown.mappings.find(
    (row) => row.cost_item_code === "FUSILLI_EFFECTIVE",
  );
  assert.equal(Number(effective.canonical_unit_cost), 69);
  assert.equal(Number(effective.unit_cost), 60);
  assert.equal(Number(effective.line_cost), 60);
  assert.equal(Number(breakdown.product.calculated_product_cost), 210);
});
