const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const directory = path.join(__dirname, "migrations");

async function migrate(direction = "up", database = pool, options = {}) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  let files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(`.${direction}.sql`))
    .sort();
  if (direction === "down") files = files.reverse();

  for (const file of files) {
    const version = file.split(".")[0];
    const applied = await database.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [version],
    );
    if (direction === "up" ? applied.rowCount : !applied.rowCount) continue;

    const client = await database.connect();
    try {
      await client.query("BEGIN");
      let sql = fs.readFileSync(path.join(directory, file), "utf8");
      if (options.compatibility === "pg-mem") {
        sql = sql.replaceAll(" NOT VALID", "");
        sql = sql.replaceAll(
          "manual_review_interval_days || ' days'",
          "manual_review_interval_days::text || ' days'",
        );
        sql = sql.replace(
          /UPDATE marketplace_registry\s+SET capabilities=JSONB_SET\(\s+COALESCE\(capabilities,'\{}'::jsonb\),\s+'\{supportsCommissionApi\}',\s+'true'::jsonb,\s+TRUE\s+\),\s+updated_at=NOW\(\)\s+WHERE code='HEPSIBURADA';/g,
          `UPDATE marketplace_registry
SET capabilities='{"supportsCatalogSearch":false,"supportsCatalogProductRead":true,"supportsExistingCatalogOfferCreate":false,"supportsNewProductCreate":false,"supportsCategorySync":false,"supportsAttributeSync":false,"supportsBrandSync":false,"supportsCommissionApi":true,"supportsBuybox":false,"supportsContentUpdate":false,"supportsImageUpdate":false,"supportsVideo":false,"supportsOrders":true,"supportsFinancialTransactions":false,"supportsPriceUpdate":false,"supportsInventoryUpdate":false,"supportsBatchStatus":false,"supportsListingVerification":false}'::jsonb,
    updated_at=NOW()
WHERE code='HEPSIBURADA';`,
        );
        sql = sql.replace(
          /UPDATE marketplace_registry\s+SET capabilities=JSONB_SET\(\s+COALESCE\(capabilities,'\{}'::jsonb\),\s+'\{supportsCommissionApi\}',\s+'false'::jsonb,\s+TRUE\s+\),\s+updated_at=NOW\(\)\s+WHERE code='HEPSIBURADA';/g,
          `UPDATE marketplace_registry
SET capabilities='{"supportsCatalogSearch":false,"supportsCatalogProductRead":true,"supportsExistingCatalogOfferCreate":false,"supportsNewProductCreate":false,"supportsCategorySync":false,"supportsAttributeSync":false,"supportsBrandSync":false,"supportsCommissionApi":false,"supportsBuybox":false,"supportsContentUpdate":false,"supportsImageUpdate":false,"supportsVideo":false,"supportsOrders":true,"supportsFinancialTransactions":false,"supportsPriceUpdate":false,"supportsInventoryUpdate":false,"supportsBatchStatus":false,"supportsListingVerification":false}'::jsonb,
    updated_at=NOW()
WHERE code='HEPSIBURADA';`,
        );
      }
      await client.query(sql);
      if (direction === "up") {
        await client.query(
          "INSERT INTO schema_migrations(version) VALUES ($1)",
          [version],
        );
      } else {
        await client.query("DELETE FROM schema_migrations WHERE version = $1", [
          version,
        ]);
      }
      await client.query("COMMIT");
      if (direction === "down") break;
    } catch (error) {
      await client.query("ROLLBACK");
      error.message = `Migration ${file} failed: ${error.message}`;
      throw error;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  migrate(process.argv[2] || "up")
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error.message);
      process.exitCode = 1;
      await pool.end();
    });
}

module.exports = { migrate };
