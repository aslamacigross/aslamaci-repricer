const test = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");
const { migrate } = require("../../src/db/migrate");
const { PimRepository } = require("../../src/repositories/pim.repository");

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

test("mevcut mappingler aynı fingerprint ile ortak reçeteye idempotent taşınır", async () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  memory.public.registerFunction({
    name: "hashtext",
    args: ["text"],
    returns: "integer",
    implementation: (value) => value.length,
  });
  memory.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: ["integer"],
    returns: "boolean",
    implementation: () => true,
  });
  const adapter = memory.adapters.createPg();
  const db = new adapter.Pool();
  await migrate("up", db, { compatibility: "pg-mem" });
  await db.query(
    `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
     VALUES('ACTISOFT_MENEKSE_1500','Menekşe Yumuşatıcı 1,5 L',112,1.5)`,
  );
  await db.query(
    `INSERT INTO products(
       marketplace,barcode,product_name,marketplace_product_id,category_id,
       stock_quantity,my_price,min_price,buybox_price,rank
     )VALUES
       ('TRENDYOL','MENEKSHE2','Menekşe 1,5 L x 2','mp-2','cat',10,400,312.28,399,1),
       ('HEPSIBURADA','HBMENEKSHE2','Menekşe 1,5 L x 2','hb-2','hb-cat',8,410,320,405,2)`,
  );
  await db.query(
    `INSERT INTO product_cost_mappings(
       marketplace,barcode,cost_item_code,quantity
     )VALUES
       ('TRENDYOL','MENEKSHE2','ACTISOFT_MENEKSE_1500',2),
       ('HEPSIBURADA','HBMENEKSHE2','ACTISOFT_MENEKSE_1500',2)`,
  );
  const repository = new PimRepository(db, transaction(db));
  const first = await repository.bootstrapExisting();
  const second = await repository.bootstrapExisting();
  assert.equal(first.recipes, 1);
  assert.equal(first.listings, 2);
  assert.equal(second.recipes, 1);
  const recipes = await db.query("SELECT * FROM pim_recipes");
  const listings = await db.query("SELECT * FROM marketplace_listings");
  assert.equal(recipes.rowCount, 1);
  assert.equal(listings.rowCount, 2);
  assert.equal(new Set(listings.rows.map((row) => row.recipe_id)).size, 1);

  const recipeId = recipes.rows[0].id;
  const firstBarcode = await repository.allocateBarcode({
    marketplace: "PAZARAMA",
    recipeId,
  });
  const secondBarcode = await repository.allocateBarcode({
    marketplace: "PAZARAMA",
    recipeId,
  });
  assert.equal(firstBarcode.id, secondBarcode.id);
  assert.equal(firstBarcode.status, "RESERVED");

  const catalogMatch = await repository.saveCatalogMatch({
    marketplace: "PAZARAMA",
    recipeId,
    marketplaceProductId: "catalog-42",
    marketplaceCatalogBarcode: "CATALOG42",
    matchStatus: "REVIEW_REQUIRED",
    matchConfidence: 97,
    matchMethod: "RULE_BASED_V1",
    evidence: { exact: true },
  });
  await repository.reviewCatalogMatch(catalogMatch.id, {
    status: "CONFIRMED",
    actor: "admin",
  });
  await repository.reviewCatalogMatch(catalogMatch.id, {
    status: "CONFIRMED",
    actor: "admin",
  });
  const identifiers = await db.query(
    `SELECT * FROM marketplace_listing_identifiers
     WHERE marketplace='PAZARAMA' AND recipe_id=$1
       AND marketplace_product_id='catalog-42'`,
    [recipeId],
  );
  assert.equal(identifiers.rowCount, 1);
  await db.end();
});
