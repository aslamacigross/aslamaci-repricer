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
    ["001_core_schema", "002_operations_and_learning"],
  );
  const safety = await db.query(
    "SELECT value FROM system_settings WHERE key='global_dry_run'",
  );
  assert.equal(safety.rows[0].value, true);
  await db.end();
});
