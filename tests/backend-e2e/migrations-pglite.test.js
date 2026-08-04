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
    assert.equal(initial.rowCount, 33);
    assert.equal(
      initial.rows.at(-1).version,
      "033_hepsiburada_listing_identifiers",
    );

    const columnsAfterUp = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name IN (
          'catalog_gtin', 'catalog_gtin_source',
          'merchant_sku', 'hb_sku', 'listing_id'
        )
      ORDER BY column_name
    `);
    assert.deepEqual(
      columnsAfterUp.rows.map((row) => row.column_name),
      [
        "catalog_gtin",
        "catalog_gtin_source",
        "hb_sku",
        "listing_id",
        "merchant_sku",
      ],
    );

    await migrate("down", db);
    const afterDown = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterDown.rowCount, 32);
    assert.equal(
      afterDown.rows.at(-1).version,
      "032_hepsiburada_verified_gtin",
    );

    const columnsAfterDown = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name IN ('merchant_sku', 'hb_sku', 'listing_id')
    `);
    assert.equal(columnsAfterDown.rowCount, 0);

    const verifiedGtinColumnsAfterDown = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name IN ('catalog_gtin', 'catalog_gtin_source')
    `);
    assert.equal(verifiedGtinColumnsAfterDown.rowCount, 2);

    await migrate("up", db);
    const afterRoundTrip = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterRoundTrip.rowCount, 33);
    assert.equal(
      afterRoundTrip.rows.at(-1).version,
      "033_hepsiburada_listing_identifiers",
    );
  } finally {
    await db.end();
  }
});
