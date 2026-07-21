const test = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");
const { migrate } = require("../../src/db/migrate");
const {
  OpportunityRepository,
} = require("../../src/repositories/opportunity.repository");
const {
  OpportunityService,
} = require("../../src/services/opportunity.service");

test("fırsat üretimi ve ret geçmişi transaction içinde idempotent kalır", async () => {
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
  const withTransaction = async (fn) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  await db.query(
    `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi,source_checked_at)
     VALUES('ACTISOFT_MENEKSE_1500','Menekşe Çamaşır Yumuşatıcısı 1,5 L',112,1.5,NOW())`,
  );
  await db.query(
    `INSERT INTO pim_physical_products(
       canonical_key,brand,product_family,product_name,variant,volume_ml,cost_item_code
     )VALUES(
       'ACTISOFT_MENEKSE_1500','Actisoft','Çamaşır Yumuşatıcısı',
       'Menekşe Çamaşır Yumuşatıcısı 1,5 L','Menekşe',1500,'ACTISOFT_MENEKSE_1500'
     )`,
  );
  const repository = new OpportunityRepository(db, withTransaction);
  const service = new OpportunityService({
    repository,
    pim: {},
    publication: {},
    marketplaceRegistry: {
      get: async () => ({
        code: "TRENDYOL",
        enabled: true,
        credentials_configured: true,
        capabilities: { supportsCatalogSearch: false },
      }),
    },
  });
  const first = await service.generate(
    {
      targetMarketplace: "TRENDYOL",
      confirmation: "FIRSATLARI_URET",
      maxBundleCandidates: 3,
    },
    "admin",
  );
  assert.equal(first.generated, 4);
  const listed = await repository.list({ marketplace: "TRENDYOL", limit: 20 });
  assert.equal(listed.total, 4);
  const rejected = await repository.transition(listed.items[0].id, {
    status: "REJECTED",
    actor: "admin",
    reason: "Bu paket satılmayacak",
    eventType: "REJECTED",
  });
  assert.equal(rejected.events.length, 1);
  await service.generate(
    {
      targetMarketplace: "TRENDYOL",
      confirmation: "FIRSATLARI_URET",
      maxBundleCandidates: 3,
    },
    "admin",
  );
  const after = await repository.get(listed.items[0].id);
  assert.equal(after.workflow_status, "REJECTED");
  assert.equal(after.rejection_reason, "Bu paket satılmayacak");
  await db.end();
});
