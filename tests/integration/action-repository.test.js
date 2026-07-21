const test = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");
const { migrate } = require("../../src/db/migrate");
const {
  ActionRepository,
} = require("../../src/repositories/action.repository");

test("aksiyon, outcome ve rollback iliskileri gercek semada atomik calisir", async () => {
  const memory = newDb({
    autoCreateForeignKeyIndices: true,
    noAstCoverageCheck: true,
  });
  memory.public.registerFunction({
    name: "hashtext",
    args: ["text"],
    returns: "integer",
    implementation: (value) => value.length,
  });
  const adapter = memory.adapters.createPg();
  const db = new adapter.Pool();
  await migrate("up", db, { compatibility: "pg-mem" });
  const transaction = async (work) => {
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
  const actions = new ActionRepository(db, transaction);
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,commission_rate,my_price,list_price,
      stock_quantity,on_sale,approved,calculated_product_cost,
      calculated_shipping_cost,packaging_cost,service_fee,min_price,data_complete
    )VALUES('TRENDYOL',$1,$2,17,320,320,10,TRUE,TRUE,112,79,15,13.19,312.28,TRUE)`,
    ["8690609598109", "Menekşe Konsantre Yumuşatıcı"],
  );
  const original = await actions.create({
    barcode: "8690609598109",
    product_name: "Menekşe Konsantre Yumuşatıcı",
    old_price: 320,
    proposed_price: 312.28,
    action: "FIYAT_DUSUR",
    strategy: "Normal",
    reason: "1. sıraya kontrollü geçiş",
    idempotency_key: "repository-test-original",
    min_price: 312.28,
    buybox_before: 313,
    rank_before: 2,
    target_rank: 1,
    second_price: 320,
    third_price: 325,
    expected_profit: 40,
    expected_margin: 12.81,
    net_profit_before: 46.4,
    safety_checks: { safe: true },
    expires_at: new Date(Date.now() + 60000),
  });
  assert.equal(
    Number((await actions.findOpen(original.barcode)).id),
    original.id,
  );
  assert.equal(
    await actions.findOpen(original.barcode, db, original.id),
    undefined,
  );

  await actions.recordMarketPreflight(original.id, 320);
  await actions.updateStatus(original.id, "AWAITING_RESULT", {
    actor: "admin",
    batchId: "test-batch",
  });
  const confirmed = await actions.confirmApplied(original.id, {
    marketProduct: { salePrice: 312.28, listPrice: 312.28 },
    batchResponse: {
      items: [
        {
          requestItem: { barcode: original.barcode },
          status: "SUCCESS",
        },
      ],
    },
  });
  assert.equal(Number(confirmed.applied_price), 312.28);
  assert.ok(confirmed.verified_at);
  const verifiedProduct = await db.query(
    "SELECT my_price,last_price_change_at FROM products WHERE barcode=$1",
    [original.barcode],
  );
  assert.equal(Number(verifiedProduct.rows[0].my_price), 312.28);
  assert.ok(verifiedProduct.rows[0].last_price_change_at);
  const priceLog = await db.query(
    "SELECT COUNT(*)::int count FROM price_war_log WHERE barcode=$1",
    [original.barcode],
  );
  assert.equal(priceLog.rows[0].count, 1);
  const recorded = await actions.recordOutcome(
    {
      ...original,
      applied_price: 312.28,
      rank_after: 1,
      buybox_after: 312.28,
      profit_after: 40,
    },
    {
      buyboxWon: true,
      buyboxLost: false,
      targetAchieved: true,
      elapsedMinutes: 5,
      result: "BUYBOX_WON",
    },
  );
  assert.ok(recorded);
  for (const table of [
    "repricer_outcomes",
    "price_change_outcomes",
    "repricer_results",
  ]) {
    const count = await db.query(`SELECT COUNT(*)::int count FROM ${table}`);
    assert.equal(count.rows[0].count, 1);
  }

  await actions.updateStatus(original.id, "SUCCESS");
  const reversal = await actions.create({
    barcode: original.barcode,
    product_name: original.product_name,
    old_price: 312.28,
    proposed_price: 320,
    action: "FIYAT_ARTIR",
    strategy: "Manuel",
    reason: "Güvenli geri alma",
    source: "ROLLBACK",
    idempotency_key: "repository-test-rollback",
    min_price: 312.28,
    buybox_before: 312.28,
    rank_before: 1,
    target_rank: 1,
    expected_profit: 46.4,
    expected_margin: 14.5,
    net_profit_before: 40,
    safety_checks: { safe: true },
    expires_at: new Date(Date.now() + 60000),
    reverts_action_id: original.id,
  });
  assert.equal(Number(reversal.reverts_action_id), original.id);
  const reverted = await actions.markReverted(original.id, reversal.id);
  assert.equal(reverted.status, "REVERTED");
  assert.equal(Number(reverted.reverted_by_action_id), reversal.id);
  await db.end();
});
