const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const directory = path.join(__dirname, "migrations");

async function applyPgMemCompatibilityMigration(client, version, direction) {
  if (version !== "030_hepsiburada_commission_api") return false;

  const result = await client.query(
    "SELECT capabilities FROM marketplace_registry WHERE code='HEPSIBURADA'",
  );
  if (!result.rowCount) return true;

  const rawCapabilities = result.rows[0].capabilities;
  let capabilities = rawCapabilities;
  if (typeof rawCapabilities === "string") {
    try {
      capabilities = JSON.parse(rawCapabilities);
    } catch {
      capabilities = {};
    }
  }
  if (
    !capabilities ||
    typeof capabilities !== "object" ||
    Array.isArray(capabilities)
  )
    capabilities = {};

  await client.query(
    `UPDATE marketplace_registry
     SET capabilities=$1::jsonb,updated_at=NOW()
     WHERE code='HEPSIBURADA'`,
    [
      JSON.stringify({
        ...capabilities,
        supportsCommissionApi: direction === "up",
      }),
    ],
  );
  return true;
}

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
        sql = sql
          .replaceAll(" NOT VALID", "")
          .replace(
            /\(manual_review_interval_days\s*\|\|\s*' days'\)::interval/g,
            "(manual_review_interval_days::text || ' days')::interval",
          );
      }
      const pgMemHandled =
        options.compatibility === "pg-mem" &&
        (await applyPgMemCompatibilityMigration(client, version, direction));
      if (!pgMemHandled) await client.query(sql);
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
