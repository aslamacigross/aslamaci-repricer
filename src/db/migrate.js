const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const directory = path.join(__dirname, "migrations");

async function migrate(direction = "up", database = pool) {
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
  if (direction === "down") files = files.reverse().slice(0, 1);

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
      await client.query(fs.readFileSync(path.join(directory, file), "utf8"));
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
