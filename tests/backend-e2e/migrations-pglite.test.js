const test = require("node:test");
const assert = require("node:assert/strict");
const { migrate } = require("../../src/db/migrate");
const { createPglitePool } = require("../helpers/pglite-pool");

test("PostgreSQL migrationlari up, idempotency, down ve yeniden up calisir", async () => {
  const db = await createPglitePool();
  try {
    await migrate("up", db);
    await migrate("up", db);

    const initial = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(initial.rowCount, 31);
    assert.equal(
      initial.rows.at(-1).version,
      "031_hepsiburada_catalog_barcode",
    );

    await migrate("down", db);
    const afterDown = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterDown.rowCount, 30);
    assert.equal(
      afterDown.rows.at(-1).version,
      "030_hepsiburada_commission_api",
    );

    await migrate("up", db);
    const afterRoundTrip = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterRoundTrip.rowCount, 31);
    assert.equal(
      afterRoundTrip.rows.at(-1).version,
      "031_hepsiburada_catalog_barcode",
    );
  } finally {
    await db.end();
  }
});
