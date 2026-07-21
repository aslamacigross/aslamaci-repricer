const test = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");
const { migrate } = require("../../src/db/migrate");
const { ContentRepository } = require("../../src/repositories/content.repository");

test("içerik taslağı, diff ve rollback snapshotı transaction içinde korunur", async () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  memory.public.registerFunction({ name: "hashtext", args: ["text"], returns: "integer", implementation: (value) => value.length });
  const adapter = memory.adapters.createPg();
  const db = new adapter.Pool();
  await migrate("up", db, { compatibility: "pg-mem" });
  const transaction = async (fn) => {
    const client = await db.connect();
    try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  };
  const recipe = (await db.query(
    `INSERT INTO pim_recipes(recipe_code,recipe_name,recipe_type,bundle_fingerprint,status)
     VALUES('R-CONTENT','Menekşe 1,5 L x 4','PACK','fp-content','APPROVED') RETURNING *`,
  )).rows[0];
  const listing = (await db.query(
    `INSERT INTO marketplace_listings(
       marketplace,recipe_id,seller_listing_barcode,title,description,images
     )VALUES('TRENDYOL',$1,'LIST-1','Eski başlık','Eski açıklama','[]'::jsonb) RETURNING *`,
    [recipe.id],
  )).rows[0];
  const repository = new ContentRepository(db, transaction);
  const draft = await repository.saveDraft({
    idempotencyKey: "content-key", marketplace: "TRENDYOL", recipeId: recipe.id,
    listingId: listing.id, providerMode: "MOCK_DRAFT", sourceFacts: { packageCount: 4 },
    currentContent: { title: "Eski başlık" }, proposedContent: { title: "Yeni başlık" },
    diff: [{ field: "title" }], currentChecksum: "old", proposedChecksum: "new",
  });
  assert.equal(draft.snapshots.length, 2);
  const updated = await repository.updateDraft(draft.id, {
    proposedContent: { title: "Düzenlenen başlık" }, diff: [{ field: "title" }],
    safetyErrors: [], safetyWarnings: [], checksum: "edited", actor: "admin",
  });
  assert.equal(updated.workflow_status, "HUMAN_REVIEW");
  assert.equal(updated.snapshots.length, 3);
  const approved = await repository.approveDraft(draft.id, "admin", "approved");
  assert.equal(approved.workflow_status, "APPROVED");
  assert.equal(approved.snapshots.some((item) => item.snapshot_type === "APPROVED"), true);
  await db.end();
});
