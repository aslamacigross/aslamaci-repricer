const test = require("node:test");
const assert = require("node:assert/strict");
const { migrate } = require("../../src/db/migrate");
const { createPglitePool } = require("../helpers/pglite-pool");
const {
  CanonicalCostRepository,
} = require("../../src/repositories/canonical-cost.repository");
const { CostRepository } = require("../../src/repositories/cost.repository");
const { CostEngineService } = require("../../src/services/cost-engine.service");

async function fixture() {
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
  return {
    db,
    canonical: new CanonicalCostRepository(db, withTransaction),
    costs: new CostRepository(db, withTransaction),
  };
}

async function addCostItem(db, code, cost = 100, desi = 1) {
  return (
    await db.query(
      `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [code, `${code} ürünü`, cost, desi],
    )
  ).rows[0];
}

async function addSupplierOffer(
  db,
  sourceKey,
  supplierCode = "BIM",
  price = 90,
) {
  return (
    await db.query(
      `INSERT INTO file_market_items(
         source_key,product_name,normalized_name,current_price,supplier_code
       )VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [
        sourceKey,
        `${sourceKey} ürünü`,
        sourceKey.toLowerCase(),
        price,
        supplierCode,
      ],
    )
  ).rows[0];
}

test("canonical cost foundation additive ve geriye uyumlu çalışır", async (t) => {
  const { db, canonical, costs } = await fixture();
  t.after(() => db.end());

  await t.test(
    "cost_items.id canonical kimliktir ve item_code alias uyumluluğu korunur",
    async () => {
      const item = await addCostItem(db, "CANONICAL_ALIAS");
      await canonical.createAlias({
        aliasCode: "OLD_CANONICAL_ALIAS",
        canonicalCostItemId: item.id,
        actor: "phase-2a-test",
        reason: "legacy code",
      });

      const direct = await canonical.resolveCostItemIdentity("CANONICAL_ALIAS");
      const aliased = await canonical.resolveCostItemIdentity(
        "OLD_CANONICAL_ALIAS",
      );
      assert.equal(Number(direct.id), Number(item.id));
      assert.equal(direct.resolution_source, "ITEM_CODE");
      assert.equal(Number(aliased.id), Number(item.id));
      assert.equal(aliased.resolution_source, "ALIAS");
      await assert.rejects(
        canonical.createAlias({
          aliasCode: "CANONICAL_ALIAS",
          canonicalCostItemId: item.id,
          actor: "phase-2a-test",
        }),
        (error) => error.code === "COST_ITEM_ALIAS_CONFLICT",
      );
    },
  );

  await t.test(
    "bir canonical item çok offer alır ama tek selected offer taşır",
    async () => {
      const item = await addCostItem(db, "MULTI_OFFER");
      const first = await addSupplierOffer(db, "MULTI-1", "FILE_MARKET", 95);
      const second = await addSupplierOffer(db, "MULTI-2", "BIZIM_MARKET", 90);
      const firstLink = await canonical.linkSupplierOffer({
        costItemId: item.id,
        supplierOfferId: first.id,
        status: "APPROVED",
        isSelected: true,
        approvedBy: "phase-2a-test",
        selectionReason: "user selected initial source",
      });
      const secondLink = await canonical.linkSupplierOffer({
        costItemId: item.id,
        supplierOfferId: second.id,
        status: "APPROVED",
        approvedBy: "phase-2a-test",
      });

      await assert.rejects(
        canonical.linkSupplierOffer({
          costItemId: item.id,
          supplierOfferId: (await addSupplierOffer(db, "MULTI-3")).id,
          status: "APPROVED",
          isSelected: true,
          approvedBy: "phase-2a-test",
          selectionReason: "must conflict with existing selection",
        }),
      );

      await canonical.selectSupplierOffer({
        costItemId: item.id,
        relationId: secondLink.id,
        actor: "phase-2a-test",
        reason: "user selected",
      });
      const links = await db.query(
        `SELECT id,is_selected FROM cost_item_supplier_offers
       WHERE cost_item_id=$1 ORDER BY id`,
        [item.id],
      );
      assert.deepEqual(
        links.rows.map((row) => [Number(row.id), row.is_selected]),
        [
          [Number(firstLink.id), false],
          [Number(secondLink.id), true],
        ],
      );
      const unchanged = await db.query(
        "SELECT unit_cost FROM cost_items WHERE id=$1",
        [item.id],
      );
      assert.equal(Number(unchanged.rows[0].unit_cost), 100);
    },
  );

  await t.test(
    "approved supplier offer iki canonical item'a sahip olamaz",
    async () => {
      const firstItem = await addCostItem(db, "OFFER_OWNER_A");
      const secondItem = await addCostItem(db, "OFFER_OWNER_B");
      const offer = await addSupplierOffer(db, "ONE-OWNER");
      await canonical.linkSupplierOffer({
        costItemId: firstItem.id,
        supplierOfferId: offer.id,
        status: "APPROVED",
        approvedBy: "phase-2a-test",
      });
      await assert.rejects(
        canonical.linkSupplierOffer({
          costItemId: secondItem.id,
          supplierOfferId: offer.id,
          status: "APPROVED",
          approvedBy: "phase-2a-test",
        }),
      );
    },
  );

  await t.test(
    "manual offer metadata kaydedilir ve maliyeti otomatik değiştirmez",
    async () => {
      const item = await addCostItem(db, "MANUAL_FOUNDATION", 125);
      const created = await canonical.createManualOffer({
        costItemId: item.id,
        sourceKey: "MANUAL:FOUNDATION:1",
        productName: "Manuel Test Ürünü",
        currentPrice: 110,
        physicalSupplierCode: "BIM",
        checkedAt: "2026-09-13T09:00:00Z",
        actor: "phase-2a-test",
      });
      assert.equal(created.offer.offer_type, "MANUAL");
      assert.equal(created.offer.supplier_code, "OTHER");
      assert.equal(created.offer.physical_supplier_code, "BIM");
      assert.equal(created.relation.is_selected, false);
      const unchanged = await db.query(
        "SELECT unit_cost FROM cost_items WHERE id=$1",
        [item.id],
      );
      assert.equal(Number(unchanged.rows[0].unit_cost), 125);
      await assert.rejects(
        canonical.createManualOffer({
          costItemId: item.id,
          sourceKey: "MANUAL:FOUNDATION:MISSING-CHECK",
          productName: "Kontrol tarihi olmayan ürün",
          currentPrice: 110,
          physicalSupplierCode: "BIM",
          actor: "phase-2a-test",
        }),
        (error) => error.code === "VALIDATION_ERROR",
      );
    },
  );

  await t.test(
    "replacement ilişkisi selected source'u kendiliğinden değiştirmez",
    async () => {
      const item = await addCostItem(db, "REPLACEMENT_FOUNDATION");
      const oldOffer = await addSupplierOffer(db, "REPLACEMENT-OLD", "BIM", 65);
      const newOffer = await addSupplierOffer(db, "REPLACEMENT-NEW", "BIM", 79);
      const selected = await canonical.linkSupplierOffer({
        costItemId: item.id,
        supplierOfferId: oldOffer.id,
        status: "APPROVED",
        isSelected: true,
        approvedBy: "phase-2a-test",
        selectionReason: "user selected old source",
      });
      const relation = await canonical.createOfferRelation({
        fromSupplierOfferId: oldOffer.id,
        toSupplierOfferId: newOffer.id,
        relationType: "REPLACED_BY",
        status: "APPROVED",
        approvedBy: "phase-2a-test",
        reason: "same physical product, new source identity",
      });
      assert.equal(relation.relation_type, "REPLACED_BY");
      const stillSelected = await db.query(
        "SELECT supplier_offer_id FROM cost_item_supplier_offers WHERE id=$1 AND is_selected=TRUE",
        [selected.id],
      );
      assert.equal(
        Number(stillSelected.rows[0].supplier_offer_id),
        Number(oldOffer.id),
      );
      const reversed = await canonical.reverseOfferRelation(relation.id, {
        actor: "phase-2a-test",
        reason: "user reversed relation",
      });
      assert.equal(reversed.status, "REVERSED");
      assert.equal(reversed.reversed_by, "phase-2a-test");
      const selectedAfterReversal = await db.query(
        "SELECT supplier_offer_id FROM cost_item_supplier_offers WHERE id=$1 AND is_selected=TRUE",
        [selected.id],
      );
      assert.equal(
        Number(selectedAfterReversal.rows[0].supplier_offer_id),
        Number(oldOffer.id),
      );
    },
  );

  await t.test(
    "minimum reversal audit'i before/after snapshot saklar",
    async () => {
      const operation = await canonical.recordIntegrityOperation({
        batchId: "phase-2a-batch",
        operationType: "SOURCE_SELECTION",
        actor: "phase-2a-test",
        reason: "foundation verification",
        targetType: "cost_item",
        targetId: "123",
        before: { selectedOfferId: 1 },
        after: { selectedOfferId: 2 },
      });
      assert.deepEqual(operation.before_snapshot, { selectedOfferId: 1 });
      assert.deepEqual(operation.after_snapshot, { selectedOfferId: 2 });
      const reversed = await canonical.markIntegrityOperationReversed(
        operation.id,
        {
          actor: "phase-2a-test",
          reason: "rollback verified",
        },
      );
      assert.equal(reversed.status, "REVERSED");
      assert.equal(reversed.reversed_by, "phase-2a-test");
    },
  );

  await t.test(
    "yeni orphan mapping ve supplier link yazımları reddedilir",
    async () => {
      const supplier = await addSupplierOffer(db, "ORPHAN-GUARD");
      await assert.rejects(
        db.query(
          `INSERT INTO product_cost_mappings(
           marketplace,barcode,cost_item_code,quantity
         )VALUES('TRENDYOL','ORPHAN-NEW','DOES_NOT_EXIST',1)`,
        ),
      );
      await assert.rejects(
        db.query(
          `INSERT INTO cost_item_file_links(
           cost_item_code,file_market_item_id,status
         )VALUES('DOES_NOT_EXIST',$1,'APPROVED')`,
          [supplier.id],
        ),
      );
      await assert.rejects(
        canonical.linkSupplierOffer({
          costItemId: 99999999,
          supplierOfferId: supplier.id,
        }),
      );
    },
  );

  await t.test(
    "cost item silme legacy supplier link varken açıkça engellenir",
    async () => {
      const item = await addCostItem(db, "DELETE_GUARD");
      const offer = await addSupplierOffer(db, "DELETE-GUARD");
      await db.query(
        `INSERT INTO cost_item_file_links(
         cost_item_code,file_market_item_id,status
       )VALUES($1,$2,'APPROVED')`,
        [item.item_code, offer.id],
      );
      await assert.rejects(
        costs.deleteCostItem(item.id),
        (error) => error.code === "COST_ITEM_IN_USE",
      );
      const unreferenced = await addCostItem(db, "DELETE_ALLOWED");
      const deleted = await costs.deleteCostItem(unreferenced.id);
      assert.equal(deleted.item_code, "DELETE_ALLOWED");
    },
  );

  await t.test(
    "Trendyol ve HB aynı canonical item'a izole mappinglerle bağlanır",
    async () => {
      const shared = await addCostItem(db, "SHARED_CANONICAL");
      const replacement = await addCostItem(db, "TRENDYOL_REPLACEMENT");
      await db.query(
        `INSERT INTO product_cost_mappings(
         marketplace,barcode,cost_item_code,quantity
       )VALUES
         ('TRENDYOL','SHARED-BARCODE',$1,1),
         ('HEPSIBURADA','SHARED-BARCODE',$1,1)`,
        [shared.item_code],
      );
      await db.query(
        `UPDATE product_cost_mappings SET cost_item_code=$1
       WHERE marketplace='TRENDYOL' AND barcode='SHARED-BARCODE'`,
        [replacement.item_code],
      );
      const mappings = await db.query(
        `SELECT marketplace,cost_item_code FROM product_cost_mappings
       WHERE barcode='SHARED-BARCODE' ORDER BY marketplace`,
      );
      assert.deepEqual(
        mappings.rows.map((row) => [row.marketplace, row.cost_item_code]),
        [
          ["HEPSIBURADA", "SHARED_CANONICAL"],
          ["TRENDYOL", "TRENDYOL_REPLACEMENT"],
        ],
      );
    },
  );

  await t.test(
    "canonical foundation CostEngine girdisini ve sonucunu değiştirmez",
    async () => {
      await db.query(`
      INSERT INTO system_settings(key,value) VALUES
        ('default_carrier_trendyol','"CANONICAL_CARRIER"'::jsonb),
        ('default_carrier_hepsiburada','"CANONICAL_CARRIER"'::jsonb),
        ('service_fee_trendyol','10'::jsonb),
        ('service_fee_hepsiburada','10'::jsonb)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;

      INSERT INTO shipping_barems(
        marketplace,min_basket,max_basket,barem_name,carrier,
        cost_ex_vat,cost_inc_vat,vat_rate
      )VALUES
        ('TRENDYOL',0,9999,'canonical-test','CANONICAL_CARRIER',50,50,0),
        ('HEPSIBURADA',0,9999,'canonical-test','CANONICAL_CARRIER',50,50,0);

      INSERT INTO packaging_rules(
        marketplace,min_desi,max_desi,packaging_cost,profile_name,
        rule_scope,priority,active
      )VALUES
        ('TRENDYOL',0,10,5,'canonical-test','DESI',0,TRUE),
        ('HEPSIBURADA',0,10,5,'canonical-test','DESI',0,TRUE);
    `);
      const item = await addCostItem(db, "ENGINE_CANONICAL", 100, 2);
      await db.query(
        `INSERT INTO product_cost_mappings(
         marketplace,barcode,cost_item_code,quantity
       )VALUES
         ('TRENDYOL','ENGINE-TY',$1,1),
         ('HEPSIBURADA','ENGINE-HB',$1,1)`,
        [item.item_code],
      );
      await db.query(`
      INSERT INTO products(
        marketplace,barcode,product_name,brand,category_name,
        commission_rate,my_price,service_fee,target_profit,is_active
      )VALUES
        ('TRENDYOL','ENGINE-TY','Engine TY','Test','Test',15,500,10,20,TRUE),
        ('HEPSIBURADA','ENGINE-HB','Engine HB','Test','Test',15,500,10,20,TRUE)
    `);
      const engine = new CostEngineService(db);
      await engine.recalculate(undefined, db, "TRENDYOL");
      await engine.recalculate(undefined, db, "HEPSIBURADA");
      const snapshot = async () =>
        (
          await db.query(
            `SELECT p.marketplace,ci.unit_cost,p.calculated_product_cost,
                  p.calculated_shipping_cost,p.packaging_cost,p.service_fee,
                  p.commission_rate,p.target_profit,p.min_price,
                  p.calculated_net_profit
           FROM products p
           JOIN product_cost_mappings pcm
             ON pcm.marketplace=p.marketplace AND pcm.barcode=p.barcode
           JOIN cost_items ci ON ci.item_code=pcm.cost_item_code
           WHERE p.barcode IN('ENGINE-TY','ENGINE-HB')
           ORDER BY p.marketplace`,
          )
        ).rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              key === "marketplace" ? value : Number(value),
            ]),
          ),
        );
      const before = await snapshot();
      const offer = await addSupplierOffer(
        db,
        "ENGINE-OFFER",
        "BIZIM_MARKET",
        80,
      );
      await canonical.linkSupplierOffer({
        costItemId: item.id,
        supplierOfferId: offer.id,
        status: "APPROVED",
        isSelected: true,
        approvedBy: "phase-2a-test",
        selectionReason: "user selected supplier offer",
      });
      await canonical.createAlias({
        aliasCode: "ENGINE_OLD_CODE",
        canonicalCostItemId: item.id,
        actor: "phase-2a-test",
      });
      await engine.recalculate(undefined, db, "TRENDYOL");
      await engine.recalculate(undefined, db, "HEPSIBURADA");
      const after = await snapshot();
      assert.deepEqual(after, before);
      assert.deepEqual(
        before.map((row) => ({
          marketplace: row.marketplace,
          unitCost: row.unit_cost,
          shipping: row.calculated_shipping_cost,
          commission: row.commission_rate,
          targetProfit: row.target_profit,
          minPrice: row.min_price,
        })),
        [
          {
            marketplace: "HEPSIBURADA",
            unitCost: 100,
            shipping: 50,
            commission: 15,
            targetProfit: 20,
            minPrice: 217.65,
          },
          {
            marketplace: "TRENDYOL",
            unitCost: 100,
            shipping: 50,
            commission: 15,
            targetProfit: 20,
            minPrice: 217.65,
          },
        ],
      );
    },
  );
});
