const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

// No URL, credentials or remote hosts accepted. Only an explicitly marked,
// temporary Unix-socket server owned by this test run can be used.
async function createDisposablePostgres() {
  const root = fs.realpathSync(
    process.env.ASLAMACI_DISPOSABLE_PG_ROOT || "/missing-disposable-postgres",
  );
  if (
    !root.startsWith("/private/tmp/aslamaci-") &&
    !root.startsWith("/tmp/aslamaci-")
  )
    throw new Error("Not a disposable PostgreSQL path");
  if (
    fs.readFileSync(path.join(root, ".aslamaci-disposable"), "utf8").trim() !==
    "HB_ISOLATED_TEST_ONLY"
  )
    throw new Error("Disposable PostgreSQL marker missing");
  const port = Number(process.env.ASLAMACI_DISPOSABLE_PG_PORT || 55481);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid test port");
  const config = {
    host: root,
    port,
    user: "pilot_test",
    password: "",
    max: 12,
    connectionTimeoutMillis: 5000,
  };
  const admin = new Pool({ ...config, database: "postgres" });
  const name = "aslamaci_hb_test_" + crypto.randomBytes(8).toString("hex");
  await admin.query(`CREATE DATABASE ${name}`);
  const pool = new Pool({ ...config, database: name });
  return {
    realPostgres: true,
    query: pool.query.bind(pool),
    connect: pool.connect.bind(pool),
    async end() {
      await pool.end();
      try {
        await admin.query(`DROP DATABASE ${name}`);
      } finally {
        await admin.end();
      }
    },
  };
}
module.exports = { createDisposablePostgres };
