const test = require("node:test");
const assert = require("node:assert/strict");
const { createDisposablePostgres } = require("../helpers/disposable-postgres");
const { createPglitePool } = require("../helpers/pglite-pool");
const { migrate } = require("../../src/db/migrate");
const { CostEngineService } = require("../../src/services/cost-engine.service");
const { cashFixture } = require("../helpers/hepsiburada-cash-fixture");
const {
  cashSnapshot,
  revalidateCashSnapshot,
} = require("../../src/domain/hepsiburada-commission-cash");

let db;
test.before(async () => {
  db =
    process.env.ASLAMACI_HB_DATABASE === "postgres"
      ? await createDisposablePostgres()
      : await createPglitePool();
  await migrate("up", db);
  if (db.realPostgres)
    console.log(
      "CASH AUDIT REAL PG:",
      (await db.query("SELECT version() v")).rows[0].v,
    );
});
test.after(async () => db?.end());
test.beforeEach(async () => {
  await db.query(`TRUNCATE products,product_settings,cost_items,product_cost_mappings,packaging_rules,repricer_actions RESTART IDENTITY CASCADE;
  DELETE FROM shipping_costs; DELETE FROM shipping_barems; DELETE FROM system_settings;
  INSERT INTO system_settings(key,value) VALUES('default_carrier_hepsiburada','"hepsiJET"'),('service_fee_hepsiburada','13.19');
  INSERT INTO shipping_costs(marketplace,carrier,desi_kg,cost_ex_vat,cost_inc_vat) VALUES('HEPSIBURADA','hepsiJET',1,78.5,94.2);
  INSERT INTO packaging_rules(id,min_desi,max_desi,packaging_cost,marketplace,rule_scope,match_value,active,priority) VALUES(1,0,99,5,'HEPSIBURADA','BARCODE','86O50O7117229',TRUE,1);
  INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi) VALUES('CASH-TEA','Synthetic test tea',310,1);
  INSERT INTO product_cost_mappings(marketplace,barcode,cost_item_code,quantity) VALUES('HEPSIBURADA','86O50O7117229','CASH-TEA',1);
  INSERT INTO products(marketplace,barcode,merchant_sku,hb_sku,my_price,commission_rate,desi,service_fee,target_profit,auto_update,is_active,on_sale,stock_quantity)
  VALUES('HEPSIBURADA','86O50O7117229','86O50O7117229','HBCV-CASH',499,17,1,13.19,50,TRUE,TRUE,TRUE,10),
  ('TRENDYOL','86O50O7117229','TY-ONLY',NULL,999,20,1,13,40,FALSE,TRUE,TRUE,10);
  INSERT INTO repricer_actions(marketplace,barcode,old_price,proposed_price,action,status,idempotency_key,batch_id)
  VALUES('TRENDYOL','HISTORICAL-SEND',100,110,'FIYAT_ARTIR','SENDING','keep-send',NULL),
  ('HEPSIBURADA','PENDING-PROVIDER',100,110,'FIYAT_ARTIR','AWAITING_RESULT','keep-await','MOCK-UPLOAD');`);
  await new CostEngineService(db).recalculate(
    "86O50O7117229",
    db,
    "HEPSIBURADA",
  );
});
async function inputs(client = db) {
  const f = cashFixture();
  const p = (
    await client.query(
      "SELECT * FROM products WHERE marketplace='HEPSIBURADA' AND barcode='86O50O7117229'",
    )
  ).rows[0];
  f.product = { ...f.product, ...p };
  Object.assign(f.money, {
    productCost: Number(p.calculated_product_cost),
    shippingCost: Number(p.calculated_shipping_cost),
    packagingCost: Number(p.packaging_cost),
    serviceFee: Number(p.service_fee),
  });
  return f;
}
async function state() {
  return (
    await db.query(
      "SELECT (SELECT json_agg(p ORDER BY marketplace,barcode) FROM products p) products,(SELECT json_agg(a ORDER BY id) FROM repricer_actions a) actions",
    )
  ).rows[0];
}

test("real CostEngine reproduces missing commission VAT; isolated cash snapshot exposes the difference", async () => {
  const f = await inputs();
  assert.equal(Number(f.product.min_price), 569.14);
  assert.equal(Number(f.product.calculated_net_profit), -8.22);
  assert.equal(cashSnapshot(f).contribution, -25.19);
  assert.equal(cashSnapshot(f).evidence.commission.vat, 16.97);
});
test("draft snapshot does not change prices, TY, SENDING, receipts or generate actions", async () => {
  const before = await state(),
    f = await inputs();
  for (let i = 0; i < 3; i++)
    assert.equal(cashSnapshot(f).pricingAuthorized, false);
  assert.deepEqual(await state(), before);
});
for (const change of ["cost", "commission", "price"])
  test(`two real PG connections: ${change} change invalidates draft snapshot`, async (t) => {
    if (!db.realPostgres) {
      t.skip(
        "multi-connection case runs in explicit disposable PostgreSQL suite",
      );
      return;
    }
    const reader = await db.connect(),
      writer = await db.connect();
    try {
      await reader.query("BEGIN");
      const old = cashSnapshot(await inputs(reader));
      await writer.query("BEGIN");
      const sql =
        change === "cost"
          ? "calculated_product_cost=330"
          : change === "commission"
            ? "commission_rate=18"
            : "my_price=501";
      await writer.query(
        "UPDATE products SET " +
          sql +
          " WHERE marketplace='HEPSIBURADA' AND barcode='86O50O7117229'",
      );
      await writer.query("COMMIT");
      const fresh = await inputs(reader);
      if (change === "commission") fresh.quote.rate = 18; // fresh provider mock agrees; economic hash still changed
      if (change === "price") {
        fresh.base.amount = 501;
        fresh.money.buyerRevenue = 501;
      }
      assert.throws(() => revalidateCashSnapshot(old, fresh), {
        code: "STALE_PREVIEW",
      });
      await reader.query("COMMIT");
      assert.equal((await state()).actions.length, 2);
    } finally {
      await reader.query("ROLLBACK");
      await writer.query("ROLLBACK");
      reader.release();
      writer.release();
    }
  });
test("rollback retains the original economic snapshot and every action state", async () => {
  const f = await inputs(),
    before = await state();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE products SET calculated_product_cost=999 WHERE marketplace='HEPSIBURADA'",
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  assert.equal(
    revalidateCashSnapshot(cashSnapshot(f), await inputs()).fingerprint,
    cashSnapshot(f).fingerprint,
  );
  assert.deepEqual(await state(), before);
});
