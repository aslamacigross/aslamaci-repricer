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
    assert.equal(initial.rowCount, 27);
    assert.equal(initial.rows.at(-1).version, "027_packaging_profiles");

    await migrate("down", db);
    const afterDown = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterDown.rowCount, 26);
    assert.equal(
      afterDown.rows.at(-1).version,
      "026_ai_content_and_listing_health",
    );

    await migrate("up", db);
    const afterRoundTrip = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterRoundTrip.rowCount, 27);
    assert.equal(afterRoundTrip.rows.at(-1).version, "027_packaging_profiles");
  } finally {
    await db.end();
  }
});
