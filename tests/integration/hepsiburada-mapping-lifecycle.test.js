const test = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");
const { migrate } = require("../../src/db/migrate");
const {
  MappingAutomationRepository,
} = require("../../src/repositories/mapping-automation.repository");
const { SyncService } = require("../../src/services/sync.service");
const {
  HepsiburadaService,
  parseHepsiburadaPublicCatalogHtml,
  parseHepsiburadaPublicSearchHtml,
} = require("../../src/services/hepsiburada.service");

async function pgFixture() {
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
  memory.public.registerFunction({
    name: "nullif",
    args: ["text", "text"],
    returns: "text",
    implementation: (left, right) => (left === right ? null : left),
  });
  memory.public.registerFunction({
    name: "btrim",
    args: ["text"],
    returns: "text",
    implementation: (value) => String(value || "").trim(),
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
  return { db, withTransaction };
}

function hbService(listings, metadataRows = []) {
  return {
    configured: () => true,
    fetchAllListings: async () => listings,
    fetchAllMerchantProducts: async () => metadataRows,
    getMerchantProductMetadata: async () => null,
    fetchCommissions: async () => [],
  };
}

function hbServiceWithFallbacks(listings, metadataRows = [], fallbacks = {}) {
  return {
    ...hbService(listings, metadataRows),
    ...fallbacks,
  };
}

async function hepsiburadaTargets(db, withTransaction) {
  const repository = new MappingAutomationRepository(db, withTransaction);
  return repository.targetProducts({
    marketplace: "HEPSIBURADA",
    limit: 50,
  });
}

test("HB sync bos metadata cevabiyla mevcut guvenilir metadata alanlarini silmez", async () => {
  const { db } = await pgFixture();
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,category_name,category_id,
      product_image_url,marketplace_product_id,my_price,stock_quantity,
      is_active,on_sale,approved
    )VALUES(
      'HEPSIBURADA','HB-META','Kalıcı Ürün Adı','Kalıcı Marka',
      'Kalıcı Kategori','123','https://example.test/image.jpg','HBVOLD',
      99,10,TRUE,TRUE,TRUE
    )`,
  );

  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbService([
      {
        merchantSku: "HB-META",
        hepsiburadaSku: "HBVOLD",
        productName: "",
        brand: "",
        categoryName: "",
        categoryId: "",
        price: 101,
        availableStock: 8,
        isSalable: true,
      },
    ]),
    audit: { record: async () => {} },
  });

  await sync.hepsiburadaProducts();

  const row = (
    await db.query(
      `SELECT product_name,brand,category_name,category_id,product_image_url,
              my_price,stock_quantity
       FROM products WHERE marketplace='HEPSIBURADA' AND barcode='HB-META'`,
    )
  ).rows[0];
  assert.equal(row.product_name, "Kalıcı Ürün Adı");
  assert.equal(row.brand, "Kalıcı Marka");
  assert.equal(row.category_name, "Kalıcı Kategori");
  assert.equal(row.category_id, "123");
  assert.equal(row.product_image_url, "https://example.test/image.jpg");
  assert.equal(Number(row.my_price), 101);
  assert.equal(row.stock_quantity, 8);
  await db.end();
});

test("HB targetProducts yalniz anlamli product_name olan urunleri mapping target yapmali", async () => {
  const { db, withTransaction } = await pgFixture();
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,is_active,data_status,
      stock_quantity,my_price,commission_rate
    )VALUES
      ('HEPSIBURADA','HB_NULL',NULL,'Actisoft',TRUE,'MAPPING_MISSING',5,100,17),
      ('HEPSIBURADA','HB_EMPTY','','Actisoft',TRUE,'MAPPING_MISSING',5,100,17),
      ('HEPSIBURADA','HB_SPACE','   ','Actisoft',TRUE,'MAPPING_MISSING',5,100,17),
      ('HEPSIBURADA','HB_REAL','Actisoft Çamaşır Suyu 1000 ml','Actisoft',TRUE,'MAPPING_MISSING',5,100,17)`,
  );
  const repository = new MappingAutomationRepository(db, withTransaction);

  const targets = await repository.targetProducts({
    marketplace: "HEPSIBURADA",
    limit: 20,
  });

  assert.deepEqual(
    targets.map((row) => row.barcode),
    ["HB_REAL"],
  );
  await db.end();
});

test("HB listing kaybolunca urun pasife cekilir ancak row ve onayli mappingler korunur", async () => {
  const { db } = await pgFixture();
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,is_active,on_sale,archived,
      data_status,stock_quantity,my_price,commission_rate
    )VALUES
      ('HEPSIBURADA','HB-STILL','Kalan Ürün','Actisoft',TRUE,TRUE,FALSE,'COMPLETE',5,100,17),
      ('HEPSIBURADA','HB-GONE','Kaybolan Ürün','Actisoft',TRUE,TRUE,FALSE,'COMPLETE',5,100,17)`,
  );
  await db.query(
    `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
     VALUES('ACTISOFT_COST','Actisoft Cost',50,1)`,
  );
  const supplierItem = (
    await db.query(
      `INSERT INTO file_market_items(
        source_key,product_name,normalized_name,brand,current_price,supplier_code
      )VALUES(
        'file-api:actisoft-cost','Actisoft Cost','actisoft cost','Actisoft',50,'FILE_MARKET'
      ) RETURNING id`,
    )
  ).rows[0];
  await db.query(
    `INSERT INTO cost_item_file_links(
      cost_item_code,file_market_item_id,confidence,status,approved_by,approved_at
    )VALUES('ACTISOFT_COST',$1,0.95,'APPROVED','admin',NOW())`,
    [supplierItem.id],
  );
  await db.query(
    `INSERT INTO product_cost_mappings(
      marketplace,barcode,cost_item_code,quantity
    )VALUES('HEPSIBURADA','HB-GONE','ACTISOFT_COST',1)`,
  );

  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbService([
      {
        merchantSku: "HB-STILL",
        hepsiburadaSku: "HBVSTILL",
        productName: "Kalan Ürün",
        brand: "Actisoft",
        price: 100,
        availableStock: 5,
        isSalable: true,
      },
    ]),
    audit: { record: async () => {} },
  });

  await sync.hepsiburadaProducts();

  const gone = (
    await db.query(
      `SELECT is_active,on_sale,archived FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='HB-GONE'`,
    )
  ).rows[0];
  assert.equal(gone.is_active, false);
  assert.equal(gone.on_sale, false);
  assert.equal(gone.archived, true);
  const mapping = await db.query(
    `SELECT * FROM product_cost_mappings
     WHERE marketplace='HEPSIBURADA' AND barcode='HB-GONE'`,
  );
  assert.equal(mapping.rowCount, 1);
  const link = await db.query(
    `SELECT * FROM cost_item_file_links WHERE cost_item_code='ACTISOFT_COST'`,
  );
  assert.equal(link.rowCount, 1);
  await db.end();
});

test("HB ayni merchantSku ve hbSku ile yeniden gelirse onayli mapping korunur", async () => {
  const { db } = await pgFixture();
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,marketplace_product_id,hb_sku,
      is_active,on_sale,archived,data_status,stock_quantity,my_price,commission_rate
    )VALUES(
      'HEPSIBURADA','HB-REUSE','Tekrar Gelen Ürün','Actisoft','HBVREUSE','HBVREUSE',
      FALSE,FALSE,TRUE,'COMPLETE',0,0,17
    )`,
  );
  await db.query(
    `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
     VALUES('REUSE_COST','Reuse Cost',40,1)`,
  );
  await db.query(
    `INSERT INTO product_cost_mappings(
      marketplace,barcode,cost_item_code,quantity
    )VALUES('HEPSIBURADA','HB-REUSE','REUSE_COST',1)`,
  );

  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbService([
      {
        merchantSku: "HB-REUSE",
        hepsiburadaSku: "HBVREUSE",
        productName: "Tekrar Gelen Ürün",
        brand: "Actisoft",
        price: 120,
        availableStock: 4,
        isSalable: true,
      },
    ]),
    audit: { record: async () => {} },
  });

  await sync.hepsiburadaProducts();

  const product = (
    await db.query(
      `SELECT is_active,on_sale,archived,hb_sku FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='HB-REUSE'`,
    )
  ).rows[0];
  assert.equal(product.is_active, true);
  assert.equal(product.on_sale, true);
  assert.equal(product.archived, false);
  assert.equal(product.hb_sku, "HBVREUSE");
  const mapping = await db.query(
    `SELECT * FROM product_cost_mappings
     WHERE marketplace='HEPSIBURADA' AND barcode='HB-REUSE'`,
  );
  assert.equal(mapping.rowCount, 1);
  await db.end();
});

test("HB ayni merchantSku farkli hbSku ile gelirse eski mapping sessizce yeni identityye tasinmamali", async () => {
  const { db } = await pgFixture();
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,marketplace_product_id,hb_sku,
      is_active,on_sale,archived,data_status,stock_quantity,my_price,commission_rate
    )VALUES(
      'HEPSIBURADA','HB-REUSED-SKU','Eski Ürün','Actisoft','HBVOLD','HBVOLD',
      TRUE,TRUE,FALSE,'COMPLETE',3,100,17
    )`,
  );
  await db.query(
    `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
     VALUES('OLD_COST','Old Cost',40,1)`,
  );
  await db.query(
    `INSERT INTO product_cost_mappings(
      marketplace,barcode,cost_item_code,quantity
    )VALUES('HEPSIBURADA','HB-REUSED-SKU','OLD_COST',1)`,
  );

  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbService([
      {
        merchantSku: "HB-REUSED-SKU",
        hepsiburadaSku: "HBVNEW",
        productName: "Yeni Farklı Ürün",
        brand: "Başka Marka",
        price: 150,
        availableStock: 5,
        isSalable: true,
      },
    ]),
    audit: { record: async () => {} },
  });

  await sync.hepsiburadaProducts();

  const product = (
    await db.query(
      `SELECT hb_sku,data_status,needs_cost_mapping FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='HB-REUSED-SKU'`,
    )
  ).rows[0];
  const mapping = await db.query(
    `SELECT * FROM product_cost_mappings
     WHERE marketplace='HEPSIBURADA' AND barcode='HB-REUSED-SKU'`,
  );
  assert.equal(product.hb_sku, "HBVNEW");
  assert.equal(mapping.rowCount, 0);
  assert.equal(product.needs_cost_mapping, true);
  assert.equal(product.data_status, "HB_IDENTITY_CHANGED");
  await db.end();
});

test("HB ayni merchantSku ve hbSku farkli verified GTIN ile gelirse identity review gerektirir", async () => {
  const { db } = await pgFixture();
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,marketplace_product_id,hb_sku,
      catalog_gtin,catalog_gtin_source,is_active,on_sale,archived,data_status,
      stock_quantity,my_price,commission_rate
    )VALUES(
      'HEPSIBURADA','HB-GTIN','GTIN Ürünü','Actisoft','HBVGTIN','HBVGTIN',
      '8690000000005','HEPSIBURADA_CATALOG_API:gtin',
      TRUE,TRUE,FALSE,'COMPLETE',3,100,17
    )`,
  );
  await db.query(
    `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
     VALUES('GTIN_COST','GTIN Cost',40,1)`,
  );
  await db.query(
    `INSERT INTO product_cost_mappings(
      marketplace,barcode,cost_item_code,quantity
    )VALUES('HEPSIBURADA','HB-GTIN','GTIN_COST',1)`,
  );

  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbService(
      [
        {
          merchantSku: "HB-GTIN",
          hepsiburadaSku: "HBVGTIN",
          price: 150,
          availableStock: 5,
          isSalable: true,
        },
      ],
      [
        {
          merchantSku: "HB-GTIN",
          hbSku: "HBVGTIN",
          productName: "GTIN Ürünü",
          brand: "Actisoft",
          gtin: "8690609598101",
        },
      ],
    ),
    audit: { record: async () => {} },
  });

  await sync.hepsiburadaProducts();

  const product = (
    await db.query(
      `SELECT catalog_gtin,data_status,needs_cost_mapping FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='HB-GTIN'`,
    )
  ).rows[0];
  const mapping = await db.query(
    `SELECT * FROM product_cost_mappings
     WHERE marketplace='HEPSIBURADA' AND barcode='HB-GTIN'`,
  );
  assert.equal(product.catalog_gtin, "8690609598101");
  assert.equal(mapping.rowCount, 0);
  assert.equal(product.needs_cost_mapping, true);
  assert.equal(product.data_status, "HB_IDENTITY_CHANGED");
  await db.end();
});

test("HB official katalog metadata getirirse eksik urun resolve olur ve mapping targeta girer", async () => {
  const { db, withTransaction } = await pgFixture();
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,category_name,category_id,
      product_image_url,hb_sku,is_active,on_sale,approved,data_status,
      needs_cost_mapping,stock_quantity,my_price,commission_rate
    )VALUES(
      'HEPSIBURADA','HB-OFFICIAL',NULL,NULL,NULL,NULL,NULL,'HBVOFFICIAL',
      TRUE,TRUE,TRUE,'HB_METADATA_INCOMPLETE',TRUE,5,100,17
    )`,
  );

  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbService(
      [
        {
          merchantSku: "HB-OFFICIAL",
          hepsiburadaSku: "HBVOFFICIAL",
          price: 120,
          availableStock: 8,
          isSalable: true,
        },
      ],
      [
        {
          merchantSku: "HB-OFFICIAL",
          hbSku: "HBVOFFICIAL",
          productName: "Actisoft Çamaşır Suyu 1000 ml",
          brand: "Actisoft",
          categoryName: "Temizlik",
          categoryId: 123,
          images: ["https://example.test/actisoft.jpg"],
        },
      ],
    ),
    audit: { record: async () => {} },
  });

  await sync.hepsiburadaProducts();

  const product = (
    await db.query(
      `SELECT product_name,brand,category_name,category_id,product_image_url,
              data_status,needs_cost_mapping
       FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='HB-OFFICIAL'`,
    )
  ).rows[0];
  assert.equal(product.product_name, "Actisoft Çamaşır Suyu 1000 ml");
  assert.equal(product.brand, "Actisoft");
  assert.equal(product.category_name, "Temizlik");
  assert.equal(product.category_id, "123");
  assert.equal(product.product_image_url, "https://example.test/actisoft.jpg");
  assert.equal(product.data_status, "MAPPING_MISSING");
  assert.equal(product.needs_cost_mapping, true);

  const targets = await hepsiburadaTargets(db, withTransaction);
  assert.deepEqual(
    targets.map((row) => row.barcode),
    ["HB-OFFICIAL"],
  );
  await db.end();
});

test("HB hicbir kaynak metadata cozemezse incomplete kalir ve mapping target olmaz", async () => {
  const { db, withTransaction } = await pgFixture();
  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbService([
      {
        merchantSku: "HB-NO-META",
        hepsiburadaSku: "HBVNOMETA",
        productName: "",
        brand: "",
        categoryName: "",
        price: 90,
        availableStock: 4,
        isSalable: true,
      },
    ]),
    audit: { record: async () => {} },
  });

  await sync.hepsiburadaProducts();

  const product = (
    await db.query(
      `SELECT product_name,brand,category_name,data_status,needs_cost_mapping
       FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='HB-NO-META'`,
    )
  ).rows[0];
  assert.equal(product.product_name, null);
  assert.equal(product.brand, null);
  assert.equal(product.category_name, null);
  assert.equal(product.data_status, "HB_METADATA_INCOMPLETE");
  assert.equal(product.needs_cost_mapping, true);

  const targets = await hepsiburadaTargets(db, withTransaction);
  assert.equal(targets.some((row) => row.barcode === "HB-NO-META"), false);
  await db.end();
});

test("HB ayni hbSku yeni merchantSku ile gelirse kalici metadata resolver yeniden cozum istemez", async () => {
  const { db } = await pgFixture();
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,category_name,category_id,
      product_image_url,marketplace_product_id,hb_sku,listing_id,is_active,
      on_sale,approved,data_status,stock_quantity,my_price,commission_rate
    )VALUES(
      'HEPSIBURADA','OLD-MSKU','Kalıcı HB Ürün','Harras','Atıştırmalık',
      '45','https://example.test/harras.jpg','HBVPERSIST','HBVPERSIST',
      'listing-old',TRUE,TRUE,TRUE,'COMPLETE',5,100,17
    )`,
  );

  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbService([
      {
        merchantSku: "NEW-MSKU",
        hepsiburadaSku: "HBVPERSIST",
        listingId: "listing-new",
        productName: "",
        brand: "",
        categoryName: "",
        price: 110,
        availableStock: 6,
        isSalable: true,
      },
    ]),
    audit: { record: async () => {} },
  });

  await sync.hepsiburadaProducts();

  const product = (
    await db.query(
      `SELECT product_name,brand,category_name,category_id,product_image_url,
              data_status
       FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='NEW-MSKU'`,
    )
  ).rows[0];
  assert.equal(product.product_name, "Kalıcı HB Ürün");
  assert.equal(product.brand, "Harras");
  assert.equal(product.category_name, "Atıştırmalık");
  assert.equal(product.category_id, "45");
  assert.equal(product.product_image_url, "https://example.test/harras.jpg");
  assert.notEqual(product.data_status, "HB_METADATA_INCOMPLETE");
  await db.end();
});

test("HB identity degisen urun eski metadata alanlarini kor metadata olarak reuse etmez", async () => {
  const { db } = await pgFixture();
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,category_name,category_id,
      product_image_url,marketplace_product_id,hb_sku,is_active,on_sale,
      approved,data_status,stock_quantity,my_price,commission_rate
    )VALUES(
      'HEPSIBURADA','HB-CHANGED-META','Eski Ürün','Eski Marka','Eski Kategori',
      'OLD','https://example.test/old.jpg','HBVOLD','HBVOLD',TRUE,TRUE,TRUE,
      'COMPLETE',5,100,17
    )`,
  );

  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbService([
      {
        merchantSku: "HB-CHANGED-META",
        hepsiburadaSku: "HBVNEW",
        productName: "",
        brand: "",
        categoryName: "",
        price: 130,
        availableStock: 4,
        isSalable: true,
      },
    ]),
    audit: { record: async () => {} },
  });

  await sync.hepsiburadaProducts();

  const product = (
    await db.query(
      `SELECT product_name,brand,category_name,category_id,product_image_url,
              data_status,needs_cost_mapping
       FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='HB-CHANGED-META'`,
    )
  ).rows[0];
  assert.equal(product.product_name, null);
  assert.equal(product.brand, null);
  assert.equal(product.category_name, null);
  assert.equal(product.category_id, null);
  assert.equal(product.product_image_url, null);
  assert.equal(product.data_status, "HB_IDENTITY_CHANGED");
  assert.equal(product.needs_cost_mapping, true);
  await db.end();
});

test("HB public catalog JSON-LD product metadatasini parse eder", () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Harras Tereyağlı Kurabiye 180 g",
          "brand": {"@type": "Brand", "name": "Harras"},
          "category": "Kurabiye",
          "gtin13": "8690637712142",
          "image": ["https://images.example.test/kurabiye.jpg"]
        }
      </script>
    </head></html>`;

  const metadata = parseHepsiburadaPublicCatalogHtml(html);

  assert.equal(metadata.productName, "Harras Tereyağlı Kurabiye 180 g");
  assert.equal(metadata.brand, "Harras");
  assert.equal(metadata.categoryName, "Kurabiye");
  assert.equal(metadata.gtin, "8690637712142");
  assert.equal(metadata.images[0], "https://images.example.test/kurabiye.jpg");
});

test("HB public search embedded state exact SKU metadatasini parse eder", () => {
  const html = `
    <script type='text/javascript'>
      window.MORIA = window.MORIA || {};
      window.MORIA.VERTICALFILTER = Object.assign(window.MORIA.VERTICALFILTER || {}, {
        'abc': {
          'STATE': {\\"data\\":{\\"products\\":[{\\"productId\\":\\"HBC00003AZJYZ\\",\\"brand\\":\\"Marifet\\",\\"variantList\\":[{\\"sku\\":\\"HBCV00003AZK33\\",\\"name\\":\\"Marifet Pofesyonel Kakao 2 x 1 kg\\",\\"url\\":\\"/marifet-pofesyonel-kakao-2-x-1-kg-p-HBCV00003AZK33\\",\\"images\\":[{\\"link\\":\\"https://productimages.hepsiburada.net/s/1/{size}/kakao.jpg\\"}]}]}]}}
        }
      });
    </script>`;

  const metadata = parseHepsiburadaPublicSearchHtml(html, [
    "HBCV00003AZK33",
  ]);

  assert.equal(metadata.productName, "Marifet Pofesyonel Kakao 2 x 1 kg");
  assert.equal(metadata.brand, "Marifet");
  assert.equal(
    metadata.url,
    "https://www.hepsiburada.com/marifet-pofesyonel-kakao-2-x-1-kg-p-HBCV00003AZK33",
  );
  assert.equal(
    metadata.images[0],
    "https://productimages.hepsiburada.net/s/1/500/kakao.jpg",
  );
  assert.equal(metadata.metadataDetectionMethod, "EMBEDDED_STATE");
});

test("HB public search baska SKU sonucunu metadata olarak kabul etmez", () => {
  const html = `
    <script type='text/javascript'>
      window.MORIA.VERTICALFILTER = {
        'abc': {'STATE': {\\"data\\":{\\"products\\":[{\\"brand\\":\\"Yanlış\\",\\"variantList\\":[{\\"sku\\":\\"HBCVOTHER\\",\\"name\\":\\"Yanlış Ürün\\",\\"url\\":\\"/yanlis-p-HBCVOTHER\\"}]}]}}}
      };
    </script>`;

  const metadata = parseHepsiburadaPublicSearchHtml(html, [
    "HBCV00003AZK33",
  ]);

  assert.equal(metadata, null);
});

test("HB public resolver search state ile urunu cozer ve product page ile zenginlestirir", async () => {
  const responses = new Map([
    [
      "https://www.hepsiburada.com/ara?q=HBCV0000G6MG9Y",
      {
        ok: true,
        status: 200,
        url: "https://www.hepsiburada.com/ara?q=HBCV0000G6MG9Y",
        text: async () => `
          <script type='text/javascript'>
            window.MORIA.VERTICALFILTER = {
              'abc': {'STATE': {\\"data\\":{\\"products\\":[{\\"productId\\":\\"HBC0000G6MG9V\\",\\"brand\\":\\"Dardanel\\",\\"variantList\\":[{\\"sku\\":\\"HBCV0000G6MG9Y\\",\\"name\\":\\"Dardanel Hazır Yemek Midyeli Basmati Pilav 240 gr x 4 Adet\\",\\"url\\":\\"/dardanel-hazir-yemek-midyeli-basmati-pilav-240-gr-x-4-adet-pm-HBC0000G6MG9V\\"}]}]}}}
            };
          </script>`,
      },
    ],
    [
      "https://www.hepsiburada.com/dardanel-hazir-yemek-midyeli-basmati-pilav-240-gr-x-4-adet-pm-HBC0000G6MG9V",
      {
        ok: true,
        status: 200,
        url: "https://www.hepsiburada.com/dardanel-hazir-yemek-midyeli-basmati-pilav-240-gr-x-4-adet-pm-HBC0000G6MG9V",
        text: async () => `
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Product","name":"Dardanel Hazır Yemek Midyeli Basmati Pilav 240 gr x 4","sku":"HBCV0000G6MG9Y","gtin":"8690637712142","brand":{"name":"Dardanel"},"category":"Süpermarket > Gıda > Hazır Yemek","image":["https://example.test/pilav.jpg"]}
          </script>`,
      },
    ],
  ]);
  const service = new HepsiburadaService({
    fetch: async (url) => responses.get(String(url)),
  });

  const metadata = await service.resolvePublicCatalogMetadata({
    hbSku: "HBCV0000G6MG9Y",
    productId: "HBC0000G6MG9V",
  });

  assert.equal(
    metadata.productName,
    "Dardanel Hazır Yemek Midyeli Basmati Pilav 240 gr x 4 Adet",
  );
  assert.equal(metadata.brand, "Dardanel");
  assert.equal(metadata.categoryName, "Süpermarket > Gıda > Hazır Yemek");
  assert.equal(metadata.gtin, "8690637712142");
  assert.match(metadata.metadataDetectionMethod, /EMBEDDED_STATE/);
  assert.match(metadata.metadataDetectionMethod, /JSON_LD/);
});

test("HB public resolver 404 malformed veya timeout durumunda null doner", async () => {
  const notFound = new HepsiburadaService({
    fetch: async () => ({
      ok: false,
      status: 404,
      url: "https://www.hepsiburada.com/ara?q=HBCV404",
      text: async () => "not found",
    }),
  });
  assert.equal(
    await notFound.resolvePublicCatalogMetadata({ hbSku: "HBCV404" }),
    null,
  );

  const malformed = new HepsiburadaService({
    fetch: async () => ({
      ok: true,
      status: 200,
      url: "https://www.hepsiburada.com/ara?q=HBCVMALFORMED",
      text: async () => "<html>challenge or empty search</html>",
    }),
  });
  assert.equal(
    await malformed.resolvePublicCatalogMetadata({ hbSku: "HBCVMALFORMED" }),
    null,
  );

  const timeout = new HepsiburadaService({
    timeoutMs: 1,
    fetch: async (_url, options = {}) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });
  await assert.rejects(
    () => timeout.resolvePublicCatalogMetadata({ hbSku: "HBCVTIMEOUT" }),
    /aborted/,
  );
});

test("HB official yoksa public katalog fallback metadata saglar ve mapping targeta alir", async () => {
  const { db, withTransaction } = await pgFixture();
  let publicCalls = 0;
  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbServiceWithFallbacks(
      [
        {
          merchantSku: "HB-PUBLIC",
          hepsiburadaSku: "HBCVPUBLIC",
          productName: "",
          brand: "",
          categoryName: "",
          price: 140,
          availableStock: 7,
          isSalable: true,
        },
      ],
      [],
      {
        resolvePublicCatalogMetadata: async ({ hbSku }) => {
          publicCalls++;
          assert.equal(hbSku, "HBCVPUBLIC");
          return {
            productName: "Daycare Kiraz Çiçeği Kolonya 100 ml",
            brand: "Daycare",
            categoryName: "Kolonya",
            images: ["https://example.test/daycare.jpg"],
            metadataSource: "HB_PUBLIC_CATALOG",
            metadataConfidence: 0.82,
          };
        },
      },
    ),
    audit: { record: async () => {} },
  });

  const result = await sync.hepsiburadaProducts();

  assert.equal(publicCalls, 1);
  assert.equal(result.metadata.hepsiburadaPublicCatalogResolved, 1);
  const product = (
    await db.query(
      `SELECT product_name,brand,category_name,product_image_url,data_status
       FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='HB-PUBLIC'`,
    )
  ).rows[0];
  assert.equal(product.product_name, "Daycare Kiraz Çiçeği Kolonya 100 ml");
  assert.equal(product.brand, "Daycare");
  assert.equal(product.category_name, "Kolonya");
  assert.equal(product.product_image_url, "https://example.test/daycare.jpg");
  assert.equal(product.data_status, "MAPPING_MISSING");
  const targets = await hepsiburadaTargets(db, withTransaction);
  assert.deepEqual(
    targets.map((row) => row.barcode),
    ["HB-PUBLIC"],
  );
  await db.end();
});

test("HB public source hata verirse sync crash olmaz ve incomplete kalir", async () => {
  const { db } = await pgFixture();
  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbServiceWithFallbacks(
      [
        {
          merchantSku: "HB-PUBLIC-FAIL",
          hepsiburadaSku: "HBCVFAIL",
          price: 140,
          availableStock: 7,
          isSalable: true,
        },
      ],
      [],
      {
        resolvePublicCatalogMetadata: async () => {
          throw new Error("public timeout");
        },
      },
    ),
    audit: { record: async () => {} },
  });

  const result = await sync.hepsiburadaProducts();

  assert.equal(result.failed, 0);
  assert.equal(result.metadata.hepsiburadaPublicCatalogErrors, 1);
  const product = (
    await db.query(
      `SELECT product_name,data_status FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='HB-PUBLIC-FAIL'`,
    )
  ).rows[0];
  assert.equal(product.product_name, null);
  assert.equal(product.data_status, "HB_METADATA_INCOMPLETE");
  await db.end();
});

test("HB kalici metadata varsa public resolver cagrilmaz", async () => {
  const { db } = await pgFixture();
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,category_name,product_image_url,
      hb_sku,is_active,on_sale,approved,data_status,stock_quantity,my_price,
      commission_rate
    )VALUES(
      'HEPSIBURADA','OLD-PUBLIC','Kalıcı İsim','Harras','Kurabiye',
      'https://example.test/persisted.jpg','HBCVPERSISTED',TRUE,TRUE,TRUE,
      'COMPLETE',5,100,17
    )`,
  );
  let publicCalls = 0;
  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbServiceWithFallbacks(
      [
        {
          merchantSku: "NEW-PUBLIC",
          hepsiburadaSku: "HBCVPERSISTED",
          price: 140,
          availableStock: 7,
          isSalable: true,
        },
      ],
      [],
      {
        resolvePublicCatalogMetadata: async () => {
          publicCalls++;
          return null;
        },
      },
    ),
    audit: { record: async () => {} },
  });

  await sync.hepsiburadaProducts();

  assert.equal(publicCalls, 0);
  const product = (
    await db.query(
      `SELECT product_name,brand,category_name FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='NEW-PUBLIC'`,
    )
  ).rows[0];
  assert.equal(product.product_name, "Kalıcı İsim");
  assert.equal(product.brand, "Harras");
  assert.equal(product.category_name, "Kurabiye");
  await db.end();
});

test("HB order history fallback metadata saglayabilir", async () => {
  const { db } = await pgFixture();
  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbServiceWithFallbacks(
      [
        {
          merchantSku: "HB-ORDER",
          hepsiburadaSku: "HBCVORDER",
          price: 140,
          availableStock: 7,
          isSalable: true,
        },
      ],
      [],
      {
        fetchOrderMetadata: async () => [
          {
            merchantSku: "HB-ORDER",
            hbSku: "HBCVORDER",
            productName: "Actisoft Sıvı Bulaşık Deterjanı 750 ml",
            brand: "Actisoft",
            categoryName: "Bulaşık Deterjanı",
          },
        ],
      },
    ),
    audit: { record: async () => {} },
  });

  const result = await sync.hepsiburadaProducts();

  assert.equal(result.metadata.hepsiburadaOrderMetadataResolved, 1);
  const product = (
    await db.query(
      `SELECT product_name,brand,category_name,data_status FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='HB-ORDER'`,
    )
  ).rows[0];
  assert.equal(product.product_name, "Actisoft Sıvı Bulaşık Deterjanı 750 ml");
  assert.equal(product.brand, "Actisoft");
  assert.equal(product.category_name, "Bulaşık Deterjanı");
  assert.equal(product.data_status, "MAPPING_MISSING");
  await db.end();
});

test("HB verified GTIN cross-market enrichment guvenli metadata saglar", async () => {
  const { db } = await pgFixture();
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,category_name,product_image_url,
      is_active,on_sale,approved,data_status,stock_quantity,my_price,commission_rate
    )VALUES(
      'TRENDYOL','8690637712142','Harras Tereyağlı Kurabiye 180 g','Harras',
      'Kurabiye','https://example.test/ty-kurabiye.jpg',TRUE,TRUE,TRUE,
      'COMPLETE',5,100,17
    )`,
  );
  const sync = new SyncService({
    db,
    trendyol: {},
    hepsiburada: hbServiceWithFallbacks(
      [
        {
          merchantSku: "HB-GTIN-X",
          hepsiburadaSku: "HBCVGTINX",
          price: 140,
          availableStock: 7,
          isSalable: true,
        },
      ],
      [
        {
          merchantSku: "HB-GTIN-X",
          hbSku: "HBCVGTINX",
          gtin: "8690637712142",
        },
      ],
    ),
    audit: { record: async () => {} },
  });

  const result = await sync.hepsiburadaProducts();

  assert.equal(result.metadata.hepsiburadaVerifiedGtinResolved, 1);
  const product = (
    await db.query(
      `SELECT product_name,brand,category_name,product_image_url,catalog_gtin,
              data_status
       FROM products
       WHERE marketplace='HEPSIBURADA' AND barcode='HB-GTIN-X'`,
    )
  ).rows[0];
  assert.equal(product.product_name, "Harras Tereyağlı Kurabiye 180 g");
  assert.equal(product.brand, "Harras");
  assert.equal(product.category_name, "Kurabiye");
  assert.equal(product.product_image_url, "https://example.test/ty-kurabiye.jpg");
  assert.equal(product.catalog_gtin, "8690637712142");
  assert.equal(product.data_status, "MAPPING_MISSING");
  await db.end();
});
