const test = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");
const { migrate } = require("../../src/db/migrate");
const {
  PublicationRepository,
} = require("../../src/repositories/publication.repository");

function transaction(db) {
  return async (work) => {
    const client = await db.connect();
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
  };
}

test("kanal aktarımı aynı idempotency key ile ikinci batch oluşturmaz", async () => {
  const memory = newDb({
    autoCreateForeignKeyIndices: true,
    noAstCoverageCheck: true,
  });
  memory.public.registerFunction({
    name: "hashtext",
    args: ["text"],
    returns: "integer",
    implementation: (value) => value.length,
  });
  const adapter = memory.adapters.createPg();
  const db = new adapter.Pool();
  await migrate("up", db, { compatibility: "pg-mem" });
  await db.query(
    `INSERT INTO pim_recipes(
       recipe_code,recipe_name,recipe_type,bundle_fingerprint,status
     )VALUES('R1','Menekşe 1,5 L x 2','PACK','fingerprint-r1','APPROVED')`,
  );
  const recipe = (
    await db.query(`SELECT id FROM pim_recipes WHERE recipe_code='R1'`)
  ).rows[0];
  const repository = new PublicationRepository(db, transaction(db));
  const input = {
    sourceMarketplace: "TRENDYOL",
    targetMarketplace: "HEPSIBURADA",
    idempotencyKey: "same-request",
    actor: "admin",
  };
  const items = [
    {
      recipeId: recipe.id,
      itemStatus: "BLOCKED",
      blockerCodes: ["MARKETPLACE_CREDENTIALS_MISSING"],
      preview: { dryRun: true },
      draftInput: {
        recipeId: recipe.id,
        sourceMarketplace: "TRENDYOL",
        targetMarketplace: "HEPSIBURADA",
        workflowStatus: "PRICE_REVIEW",
        publicationMode: "NEW_PRODUCT",
        title: "Menekşe 1,5 L x 2",
        stock: 1,
        pricingPreview: { minimumPrice: 312.28 },
        validationErrors: ["MARKETPLACE_CREDENTIALS_MISSING"],
        payload: { dryRun: true },
        actor: "admin",
      },
    },
  ];
  const first = await repository.createTransferBatch(input, items);
  const second = await repository.createTransferBatch(input, items);
  assert.equal(first.id, second.id);
  assert.equal(second.items.length, 1);
  const count = await db.query(
    `SELECT COUNT(*)::int total FROM channel_transfer_batches`,
  );
  assert.equal(count.rows[0].total, 1);
  const drafts = await db.query(
    `SELECT COUNT(*)::int total FROM product_publication_drafts`,
  );
  const transferItems = await db.query(
    `SELECT COUNT(*)::int total FROM channel_transfer_items`,
  );
  assert.equal(drafts.rows[0].total, 1);
  assert.equal(transferItems.rows[0].total, 1);
  assert.equal(
    first.items[0].publication_draft_id,
    second.items[0].publication_draft_id,
  );
  await db.end();
});
