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
    assert.equal(initial.rowCount, 35);
    assert.equal(
      initial.rows.at(-1).version,
      "035_rossmann_market_live_sync",
    );

    const columnsAfterUp = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name IN (
          'catalog_gtin',
          'catalog_gtin_source',
          'merchant_sku',
          'hb_sku',
          'listing_id'
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
    const afterRossmannDown = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterRossmannDown.rowCount, 34);
    assert.equal(
      afterRossmannDown.rows.at(-1).version,
      "034_trendyol_august_2026_shipping_tariffs",
    );
    const rossmannJobAfterDown = await db.query(
      "SELECT name FROM jobs WHERE name='sync-rossmann-market-prices'",
    );
    assert.equal(rossmannJobAfterDown.rowCount, 0);

    await migrate("down", db);
    const afterDown = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterDown.rowCount, 33);
    assert.equal(afterDown.rows.at(-1).version, "033_hepsiburada_listing_identity");

    const tariffRowsAfterDown = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM shipping_costs WHERE marketplace='TRENDYOL') AS rates,
        (SELECT COUNT(*)::int FROM shipping_barems WHERE marketplace='TRENDYOL') AS barems
    `);
    assert.equal(Number(tariffRowsAfterDown.rows[0].rates), 0);
    assert.equal(Number(tariffRowsAfterDown.rows[0].barems), 0);

    await migrate("up", db);
    const afterRoundTrip = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterRoundTrip.rowCount, 35);
    assert.equal(
      afterRoundTrip.rows.at(-1).version,
      "035_rossmann_market_live_sync",
    );
    const tariffRowsAfterRoundTrip = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM shipping_costs WHERE marketplace='TRENDYOL') AS rates,
        (SELECT COUNT(*)::int FROM shipping_barems WHERE marketplace='TRENDYOL') AS barems
    `);
    assert.equal(Number(tariffRowsAfterRoundTrip.rows[0].rates), 4210);
    assert.equal(Number(tariffRowsAfterRoundTrip.rows[0].barems), 14);
  } finally {
    await db.end();
  }
});
