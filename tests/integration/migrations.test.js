const test = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");
const { migrate } = require("../../src/db/migrate");
test("migrationlar bos veritabaninda calisir ve tekrar calistirilabilir", async () => {
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
  await migrate("up", db);
  await migrate("up", db);
  const tables = await db.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  assert.deepEqual(
    tables.rows.map((x) => x.version),
    [
      "001_core_schema",
      "002_operations_and_learning",
      "003_learning_contracts_and_operations",
      "004_market_price_verification",
    ],
  );
  const safety = await db.query(
    "SELECT value FROM system_settings WHERE key='global_dry_run'",
  );
  assert.equal(safety.rows[0].value, true);
  const contracts = await db.query(
    `SELECT DISTINCT table_name FROM information_schema.tables
     WHERE table_name IN('buybox_history','price_change_outcomes','repricer_results')
     ORDER BY table_name`,
  );
  assert.deepEqual(
    contracts.rows.map((row) => row.table_name),
    ["buybox_history", "price_change_outcomes", "repricer_results"],
  );
  const actionColumns = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='repricer_actions'
       AND column_name IN('target_rank','reverts_action_id','reverted_by_action_id',
                          'market_price_before','market_price_checked_at',
                          'batch_checked_at','verification_error')`,
  );
  assert.equal(actionColumns.rowCount, 7);
  const productSettingColumns = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='product_settings' AND column_name='max_single_change_pct'`,
  );
  assert.equal(productSettingColumns.rowCount, 1);
  await migrate("down", db);
  const afterDown = await db.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  assert.deepEqual(
    afterDown.rows.map((row) => row.version),
    [
      "001_core_schema",
      "002_operations_and_learning",
      "003_learning_contracts_and_operations",
    ],
  );
  const removedColumns = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE (table_name='repricer_actions' AND column_name='market_price_before')
        OR (table_name='product_settings' AND column_name='max_single_change_pct')`,
  );
  assert.equal(removedColumns.rowCount, 0);
  await db.end();
});
