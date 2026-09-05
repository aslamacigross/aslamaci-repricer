const test = require("node:test");
const assert = require("node:assert/strict");
const { CostEngineService } = require("../../src/services/cost-engine.service");
const { createPglitePool } = require("../helpers/pglite-pool");

async function createFixture() {
  const db = await createPglitePool();
  await db.query(`
    CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE cost_items(
      item_code TEXT PRIMARY KEY,unit_cost NUMERIC NOT NULL,unit_desi NUMERIC
    );
    CREATE TABLE product_cost_mappings(
      marketplace TEXT NOT NULL,barcode TEXT NOT NULL,cost_item_code TEXT NOT NULL,
      quantity NUMERIC NOT NULL,effective_unit_cost NUMERIC
    );
    CREATE TABLE shipping_barems(
      id BIGSERIAL PRIMARY KEY,marketplace TEXT NOT NULL,carrier TEXT NOT NULL,
      min_basket NUMERIC NOT NULL,max_basket NUMERIC NOT NULL,cost_inc_vat NUMERIC NOT NULL
    );
    CREATE TABLE shipping_costs(
      marketplace TEXT NOT NULL,carrier TEXT NOT NULL,desi_kg NUMERIC NOT NULL,
      cost_inc_vat NUMERIC NOT NULL
    );
    CREATE TABLE packaging_rules(
      id BIGSERIAL PRIMARY KEY,marketplace TEXT NOT NULL,min_desi NUMERIC NOT NULL,
      max_desi NUMERIC NOT NULL,packaging_cost NUMERIC NOT NULL,
      profile_name TEXT,rule_scope TEXT NOT NULL,match_value TEXT,
      priority INTEGER NOT NULL DEFAULT 0,active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE products(
      marketplace TEXT NOT NULL,barcode TEXT NOT NULL,product_name TEXT,brand TEXT,
      category_name TEXT,commission_rate NUMERIC,my_price NUMERIC,
      manual_desi_override NUMERIC,desi NUMERIC,packaging_cost NUMERIC DEFAULT 0,
      service_fee NUMERIC,target_profit NUMERIC DEFAULT 0,
      calculated_product_cost NUMERIC DEFAULT 0,
      calculated_shipping_cost NUMERIC DEFAULT 0,
      calculated_total_cost NUMERIC DEFAULT 0,
      calculated_min_price NUMERIC DEFAULT 0,min_price NUMERIC DEFAULT 0,
      calculated_net_profit NUMERIC DEFAULT 0,calculated_net_margin NUMERIC DEFAULT 0,
      needs_cost_mapping BOOLEAN DEFAULT TRUE,data_complete BOOLEAN DEFAULT FALSE,
      data_status TEXT DEFAULT 'INCOMPLETE',packaging_rule_id BIGINT,
      packaging_profile_name TEXT,packaging_rule_source TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY(marketplace,barcode)
    );

    INSERT INTO system_settings(key,value) VALUES
      ('default_carrier_trendyol','PARITY_CARRIER'),
      ('default_carrier_hepsiburada','PARITY_CARRIER'),
      ('service_fee_trendyol','10'),
      ('service_fee_hepsiburada','10');
    INSERT INTO shipping_barems(
      marketplace,carrier,min_basket,max_basket,cost_inc_vat
    ) VALUES
      ('TRENDYOL','PARITY_CARRIER',0,9999,50),
      ('HEPSIBURADA','PARITY_CARRIER',0,9999,50);
  `);
  return db;
}

async function addMappedProduct(
  db,
  { marketplace, barcode, name, category = "Diğer", desi = 2 },
) {
  const itemCode = `${marketplace}_${barcode}`;
  await db.query(
    `INSERT INTO cost_items(item_code,unit_cost,unit_desi) VALUES($1,100,$2)`,
    [itemCode, desi],
  );
  await db.query(
    `INSERT INTO product_cost_mappings(
       marketplace,barcode,cost_item_code,quantity
     )VALUES($1,$2,$3,1)`,
    [marketplace, barcode, itemCode],
  );
  await db.query(
    `INSERT INTO products(
       marketplace,barcode,product_name,brand,category_name,
       commission_rate,my_price,service_fee
     )VALUES($1,$2,$3,'PARITY',$4,15,500,10)`,
    [marketplace, barcode, name, category],
  );
}

async function product(db, marketplace, barcode) {
  return (
    await db.query(
      `SELECT packaging_cost,packaging_rule_id,packaging_profile_name,
              packaging_rule_source,data_complete,data_status,min_price
       FROM products WHERE marketplace=$1 AND barcode=$2`,
      [marketplace, barcode],
    )
  ).rows[0];
}

test("Hepsiburada reuses existing Trendyol packaging semantics without changing Trendyol", async (t) => {
  const db = await createFixture();
  t.after(() => db.end());

  await db.query(`
    INSERT INTO packaging_rules(
      marketplace,min_desi,max_desi,packaging_cost,profile_name,
      rule_scope,match_value,priority
    )VALUES
      ('TRENDYOL',0,1,5,'Eski desi 0-1','DESI',NULL,0),
      ('TRENDYOL',1,3,15,'Eski desi 1-3','DESI',NULL,0),
      ('TRENDYOL',3,6,25,'Eski desi 3-6','DESI',NULL,0),
      ('TRENDYOL',0,999,5,'50x60 Kargo Poşeti','PRODUCT_NAME','Çay',400),
      ('TRENDYOL',0,999,5,'Kargo Poşeti','CATEGORY','Bulaşık Makinesi Deterjanı',400),
      ('HEPSIBURADA',0,999,1.5,'HB Dökme Çay','CATEGORY','Dökme Çay',1000);
  `);

  await addMappedProduct(db, {
    marketplace: "TRENDYOL",
    barcode: "TY-TEA",
    name: "Doğuş Demlik Poşet Çay",
    category: "Dökme Çay",
    desi: 2,
  });
  await addMappedProduct(db, {
    marketplace: "HEPSIBURADA",
    barcode: "HB-TEA",
    name: "Doğuş Demlik Poşet Çay",
    category: "Dökme Çay",
    desi: 2,
  });
  await addMappedProduct(db, {
    marketplace: "HEPSIBURADA",
    barcode: "HB-CLEANING",
    name: "Actisoft Tablet",
    category: "Bulaşık Makinesi Deterjanı",
    desi: 2,
  });
  await addMappedProduct(db, {
    marketplace: "HEPSIBURADA",
    barcode: "HB-DIAPER",
    name: "Bebek Bezi 40'lı",
    category: "Bebek Bezi",
    desi: 5,
  });

  const engine = new CostEngineService(db);
  await engine.recalculate(undefined, db, "TRENDYOL");
  const trendyolBeforeHbRun = await product(db, "TRENDYOL", "TY-TEA");
  await engine.recalculate(undefined, db, "HEPSIBURADA");
  const trendyolAfterHbRun = await product(db, "TRENDYOL", "TY-TEA");

  assert.deepEqual(trendyolAfterHbRun, trendyolBeforeHbRun);

  const hbTea = await product(db, "HEPSIBURADA", "HB-TEA");
  assert.equal(Number(hbTea.packaging_cost), 5);
  assert.equal(hbTea.packaging_profile_name, "50x60 Kargo Poşeti");
  assert.equal(hbTea.packaging_rule_source, "PRODUCT_NAME");
  assert.equal(hbTea.data_complete, true);

  const hbCleaning = await product(db, "HEPSIBURADA", "HB-CLEANING");
  assert.equal(Number(hbCleaning.packaging_cost), 5);
  assert.equal(hbCleaning.packaging_rule_source, "CATEGORY");
  assert.equal(hbCleaning.data_complete, true);

  const hbDiaper = await product(db, "HEPSIBURADA", "HB-DIAPER");
  assert.equal(Number(hbDiaper.packaging_cost), 25);
  assert.equal(hbDiaper.packaging_rule_source, "DESI");
  assert.equal(hbDiaper.data_complete, true);
});

test("Trendyol never consumes an HB rule and an unmatched HB product stays unmatched", async (t) => {
  const db = await createFixture();
  t.after(() => db.end());

  await db.query(`
    INSERT INTO packaging_rules(
      marketplace,min_desi,max_desi,packaging_cost,profile_name,
      rule_scope,match_value,priority
    )VALUES
      ('TRENDYOL',0,3,15,'Trendyol desi','DESI',NULL,0),
      ('HEPSIBURADA',0,3,999,'HB-only desi','DESI',NULL,1000);
  `);
  await addMappedProduct(db, {
    marketplace: "TRENDYOL",
    barcode: "TY-ISOLATION",
    name: "Nötr ürün",
    desi: 2,
  });
  await addMappedProduct(db, {
    marketplace: "HEPSIBURADA",
    barcode: "HB-OUTSIDE",
    name: "Eşleşmeyen ürün",
    desi: 1000,
  });

  const engine = new CostEngineService(db);
  await engine.recalculate(undefined, db, "TRENDYOL");
  await engine.recalculate(undefined, db, "HEPSIBURADA");

  const trendyol = await product(db, "TRENDYOL", "TY-ISOLATION");
  assert.equal(Number(trendyol.packaging_cost), 15);
  assert.equal(trendyol.packaging_profile_name, "Trendyol desi");

  const unmatchedHb = await product(db, "HEPSIBURADA", "HB-OUTSIDE");
  assert.equal(Number(unmatchedHb.packaging_cost), 0);
  assert.equal(unmatchedHb.packaging_rule_id, null);
  assert.equal(unmatchedHb.packaging_profile_name, null);
  assert.equal(unmatchedHb.data_complete, false);
  assert.equal(unmatchedHb.data_status, "PACKAGING_MISSING");
});
