const test = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");
const { migrate } = require("../../src/db/migrate");
const {
  MappingAutomationRepository,
} = require("../../src/repositories/mapping-automation.repository");
const {
  MappingAutomationService,
} = require("../../src/services/mapping-automation.service");

test("Gratis ve Watsons importu stabil upsert yapar, mapping ve canonical cost oluşturmaz", async () => {
  const memory = newDb({
    autoCreateForeignKeyIndices: true,
    noAstCoverageCheck: true,
  });
  memory.public.registerFunction({
    name: "hashtext",
    args: ["text"],
    returns: "integer",
    implementation: (value) => String(value || "").length,
  });
  const adapter = memory.adapters.createPg();
  const db = new adapter.Pool();
  await migrate("up", db, { compatibility: "pg-mem" });
  const withTransaction = async (work) => {
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
  await db.query(
    `INSERT INTO products(
       marketplace,barcode,product_name,is_active,data_status,stock_quantity,my_price
     )VALUES('TRENDYOL','EXISTING','Mevcut ürün',TRUE,'COMPLETE',5,250)`,
  );
  await db.query(
    `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
     VALUES('EXISTING_COST','Mevcut maliyet',50,1)`,
  );
  await db.query(
    `INSERT INTO product_cost_mappings(
       marketplace,barcode,cost_item_code,quantity
     )VALUES('TRENDYOL','EXISTING','EXISTING_COST',1)`,
  );
  const recalculated = [];
  const service = new MappingAutomationService({
    repository: new MappingAutomationRepository(db, withTransaction),
    costs: {},
    costEngine: {
      recalculate: async (...args) => {
        recalculated.push(args);
        return { processed: 1 };
      },
    },
  });

  await service.importSupplierItems("GRATIS", [
    {
      source_key: "gratis-api:100",
      product_name: "Aynı İsimli Ruj 01 Kırmızı",
      current_price: 100,
      availability: "AVAILABLE",
    },
    {
      source_key: "gratis-api:101",
      product_name: "Aynı İsimli Ruj 01 Kırmızı",
      current_price: 110,
      availability: "AVAILABLE",
    },
  ]);
  await service.importSupplierItems("GRATIS", [
    {
      source_key: "gratis-api:100",
      product_name: "Aynı İsimli Ruj 01 Kırmızı",
      current_price: 90,
      availability: "AVAILABLE",
    },
  ]);
  await service.importSupplierItems("WATSONS", [
    {
      source_key: "watsons-web:BP_200",
      product_name: "Aynı İsimli Ruj 01 Kırmızı",
      current_price: 120,
      availability: "AVAILABLE",
    },
  ]);

  const supplierRows = await db.query(
    `SELECT supplier_code,source_key,current_price,previous_price
     FROM file_market_items
     WHERE source_key IN('gratis-api:100','gratis-api:101','watsons-web:BP_200')
     ORDER BY source_key`,
  );
  assert.deepEqual(
    supplierRows.rows.map((row) => [
      row.supplier_code,
      row.source_key,
      Number(row.current_price),
      row.previous_price == null ? null : Number(row.previous_price),
    ]),
    [
      ["GRATIS", "gratis-api:100", 90, 100],
      ["GRATIS", "gratis-api:101", 110, null],
      ["WATSONS", "watsons-web:BP_200", 120, null],
    ],
  );
  assert.equal(
    Number((await db.query("SELECT COUNT(*) count FROM cost_item_file_links")).rows[0].count),
    0,
  );
  assert.equal(
    Number((await db.query("SELECT COUNT(*) count FROM cost_item_supplier_offers")).rows[0].count),
    0,
  );
  const cost = (
    await db.query(
      "SELECT unit_cost FROM cost_items WHERE item_code='EXISTING_COST'",
    )
  ).rows[0];
  assert.equal(Number(cost.unit_cost), 50);
  assert.equal(recalculated.length, 0);
  await db.end();
});
