const { Pool } = require("pg");
const { env } = require("./env");
const { observeDatabase } = require("../observability/request-metrics");

const rawPool = new Pool({
  connectionString: env.databaseUrl || undefined,
  ssl: env.nodeEnv === "production" ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
const pool = observeDatabase(rawPool);

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
