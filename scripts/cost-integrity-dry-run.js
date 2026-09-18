const { Pool } = require("pg");
const {
  CostIntegrityService,
} = require("../src/services/cost-integrity.service");

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required through environment injection");
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await db.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const guard = await client.query("SHOW transaction_read_only");
    if (guard.rows[0]?.transaction_read_only !== "on")
      throw new Error("Read-only transaction guard could not be verified");
    const service = new CostIntegrityService({
      db: client,
      withTransaction: async () => {
        throw new Error("Dry-run tool cannot start a write transaction");
      },
      costEngine: null,
    });
    const preview = await service.legacyBackfillPreview(client);
    process.stdout.write(
      `${JSON.stringify(
        {
          readOnly: true,
          counts: preview.counts,
          previewFingerprint: preview.previewFingerprint,
          skipped: preview.rows
            .filter((row) => row.classification !== "SAFE")
            .map((row) => ({
              legacyLinkId: row.legacy_link_id,
              costItemCode: row.cost_item_code,
              supplierOfferId: row.file_market_item_id,
              classification: row.classification,
            })),
        },
        null,
        2,
      )}\n`,
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await db.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
