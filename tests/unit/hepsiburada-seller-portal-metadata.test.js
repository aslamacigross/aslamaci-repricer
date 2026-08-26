const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HepsiburadaSellerPortalMetadataService,
  gtinDecision,
} = require("../../src/services/hepsiburada-seller-portal-metadata.service");

const CRITICAL = [
  "my_price",
  "stock_quantity",
  "commission_rate",
  "calculated_product_cost",
  "calculated_shipping_cost",
  "packaging_cost",
  "service_fee",
  "desi",
  "min_price",
  "max_price",
  "auto_update",
  "repricer_mode",
  "buybox_price",
  "rank",
  "catalog_gtin",
  "catalog_gtin_source",
  "hb_sku",
  "merchant_sku",
  "barcode",
  "data_status",
  "needs_cost_mapping",
];

function product(overrides = {}) {
  return {
    marketplace: "HEPSIBURADA",
    barcode: overrides.merchant_sku || overrides.hb_sku || "HBV1",
    merchant_sku: overrides.merchant_sku || overrides.hb_sku || "HBV1",
    hb_sku: overrides.hb_sku || "HBV1",
    product_name: overrides.product_name || "",
    brand: overrides.brand || "",
    category_name: overrides.category_name || "",
    product_name_source: overrides.product_name_source || null,
    brand_source: overrides.brand_source || null,
    category_name_source: overrides.category_name_source || null,
    catalog_gtin: overrides.catalog_gtin || null,
    catalog_gtin_source: overrides.catalog_gtin_source || null,
    data_status: overrides.data_status || "HB_METADATA_INCOMPLETE",
    needs_cost_mapping: true,
    is_active: overrides.is_active ?? true,
    my_price: 100,
    stock_quantity: 25,
    commission_rate: 17,
    calculated_product_cost: 44,
    calculated_shipping_cost: 33,
    packaging_cost: 8,
    service_fee: 13.19,
    desi: 2,
    min_price: 150,
    max_price: 250,
    auto_update: false,
    repricer_mode: "AUTOMATIC",
    buybox_price: 99,
    rank: 2,
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    hbSku: overrides.hbSku || "HBV1",
    merchantSku: overrides.merchantSku || overrides.hbSku || "HBV1",
    productName: overrides.productName || "Portal Ürün",
    brand: overrides.brand || "Portal Marka",
    categoryName: overrides.categoryName || "Portal Kategori",
    mainCategoryName: overrides.mainCategoryName || "Ana",
    rootCategoryName: overrides.rootCategoryName || "Temel",
    rawBarcode: overrides.rawBarcode || "",
    listingStatus: overrides.listingStatus || "Satışta",
  };
}

function fakeDb(products, options = {}) {
  const state = {
    products,
    metadata: new Map(options.metadata || []),
    imports: options.imports || [],
  };
  const runQuery = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes("FROM hepsiburada_seller_portal_imports")) {
      return { rows: state.imports.slice(-1) };
    }
    if (text.includes("FROM products") && text.includes("marketplace='HEPSIBURADA'")) {
      if (text.includes("COUNT(*)")) {
        if (text.includes("LEFT JOIN hepsiburada_seller_portal_metadata")) {
          return {
            rows: [
              {
                count: state.products.filter(
                  (item) => item.is_active && !state.metadata.has(item.hb_sku),
                ).length,
              },
            ],
          };
        }
        return {
          rows: [
            {
              count: state.products.filter(
                (item) => item.is_active && !String(item.product_name || "").trim(),
              ).length,
            },
          ],
        };
      }
      return { rows: state.products };
    }
    throw new Error(`Unhandled SQL: ${text.slice(0, 80)}`);
  };
  const client = {
    query: async (sql, params = []) => {
      const text = String(sql);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
      if (text.includes("INSERT INTO hepsiburada_seller_portal_imports")) {
        const importRow = {
          id: state.imports.length + 1,
          imported_at: new Date("2026-08-20T00:00:00.000Z"),
        };
        state.imports.push(importRow);
        return { rows: [importRow] };
      }
      if (text.includes("FROM products") && text.includes("marketplace='HEPSIBURADA'"))
        return runQuery(sql, params);
      if (text.includes("INSERT INTO hepsiburada_seller_portal_metadata")) {
        state.metadata.set(params[0], {
          hb_sku: params[0],
          merchant_sku: params[1],
          product_name: params[2],
          brand: params[3],
          category_name: params[4],
          catalog_gtin: params[8],
          catalog_gtin_status: params[9],
        });
        return { rows: [] };
      }
      if (text.includes("UPDATE products")) {
        const hbSku = params[0];
        const item = state.products.find((candidate) => candidate.hb_sku === hbSku);
        if (item) {
          const before = Object.fromEntries(CRITICAL.map((key) => [key, item[key]]));
          Object.assign(item, {
            product_name: params[1],
            brand: params[2],
            category_name: params[3],
            product_name_source: params[4],
            brand_source: params[5],
            category_name_source: params[6],
          });
          for (const key of CRITICAL) assert.deepEqual(item[key], before[key]);
        }
        return { rows: [] };
      }
      if (text.includes("UPDATE hepsiburada_seller_portal_imports"))
        return { rows: [] };
      throw new Error(`Unhandled SQL: ${text.slice(0, 80)}`);
    },
    release: () => {},
  };
  return { state, connect: async () => client, query: runQuery };
}

test("Hepsiburada Seller Portal import exact HBSKU ile metadata gunceller ve fiyat/kimlik guvenlik alanlarini degistirmez", async () => {
  const db = fakeDb([product({ hb_sku: "HBV1", merchant_sku: "HBV1" })]);
  const service = new HepsiburadaSellerPortalMetadataService({ db });
  const result = await service.importRecords([
    row({ hbSku: "HBV1", merchantSku: "HBV1", rawBarcode: "8690504204404" }),
  ]);
  assert.equal(result.matched, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.validGtinObserved, 1);
  assert.equal(result.validGtinAccepted, 0);
  assert.equal(db.state.products[0].product_name, "Portal Ürün");
  assert.equal(db.state.products[0].product_name_source, "HB_SELLER_PORTAL_EXPORT");
  assert.equal(db.state.products[0].catalog_gtin, null);
});

test("Hepsiburada Seller Portal import MerchantSKU mismatch durumunda skip eder", async () => {
  const db = fakeDb([
    product({ hb_sku: "HBV1", merchant_sku: "MERCHANT-OLD" }),
  ]);
  const service = new HepsiburadaSellerPortalMetadataService({ db });
  const result = await service.importRecords([
    row({ hbSku: "HBV1", merchantSku: "MERCHANT-NEW" }),
  ]);
  assert.equal(result.matched, 0);
  assert.equal(result.identityMismatch, 1);
  assert.equal(db.state.products[0].product_name, "");
});

test("Hepsiburada Seller Portal import Excel-only urun yaratmaz", async () => {
  const db = fakeDb([]);
  const service = new HepsiburadaSellerPortalMetadataService({ db });
  const result = await service.importRecords([
    row({ hbSku: "HBV1", merchantSku: "HBV1" }),
  ]);
  assert.equal(result.excelOnly, 1);
  assert.equal(db.state.products.length, 0);
});

test("Hepsiburada Seller Portal GTIN validasyonunda gecersiz ve ambiguous barkodu otomatik kabul etmez", () => {
  assert.deepEqual(gtinDecision("not-a-gtin").status, "INVALID_GTIN");
  assert.deepEqual(
    gtinDecision("8690504204404;8695077122711").status,
    "AMBIGUOUS_GTIN",
  );
});

test("Hepsiburada Seller Portal import mevcut trusted catalog_gtin alanini korur", async () => {
  const db = fakeDb([
    product({
      hb_sku: "HBV1",
      merchant_sku: "HBV1",
      catalog_gtin: "8695077122711",
      catalog_gtin_source: "HB_OFFICIAL_API:productBarcode",
    }),
  ]);
  const service = new HepsiburadaSellerPortalMetadataService({ db });
  const result = await service.importRecords([
    row({ hbSku: "HBV1", merchantSku: "HBV1", rawBarcode: "8690504204404" }),
  ]);
  assert.equal(result.validGtinObserved, 1);
  assert.equal(result.validGtinAccepted, 0);
  assert.equal(db.state.products[0].catalog_gtin, "8695077122711");
  assert.equal(
    db.state.products[0].catalog_gtin_source,
    "HB_OFFICIAL_API:productBarcode",
  );
});

test("Hepsiburada Seller Portal import official API metadata alanlarini Excel ile ezmez", async () => {
  const db = fakeDb([
    product({
      hb_sku: "HBV1",
      merchant_sku: "HBV1",
      product_name: "Official Ürün",
      brand: "Official Marka",
      category_name: "Official Kategori",
      product_name_source: "HB_OFFICIAL_API",
      brand_source: "HB_OFFICIAL_API",
      category_name_source: "HB_OFFICIAL_API",
    }),
  ]);
  const service = new HepsiburadaSellerPortalMetadataService({ db });
  const result = await service.importRecords([
    row({
      hbSku: "HBV1",
      merchantSku: "HBV1",
      productName: "Portal Ürün",
      brand: "Portal Marka",
      categoryName: "Portal Kategori",
    }),
  ]);
  assert.equal(result.matched, 1);
  assert.equal(db.state.products[0].product_name, "Official Ürün");
  assert.equal(db.state.products[0].brand, "Official Marka");
  assert.equal(db.state.products[0].category_name, "Official Kategori");
});

test("Hepsiburada Seller Portal import degraded metadata alanlarini Excel ile gunceller", async () => {
  const db = fakeDb([
    product({
      hb_sku: "HBV1",
      merchant_sku: "HBV1",
      product_name: "Public Ürün",
      brand: "Public Marka",
      category_name: "Public Kategori",
      product_name_source: "DEGRADED_FALLBACK",
      brand_source: "DEGRADED_FALLBACK",
      category_name_source: "DEGRADED_FALLBACK",
    }),
  ]);
  const service = new HepsiburadaSellerPortalMetadataService({ db });
  const result = await service.importRecords([
    row({
      hbSku: "HBV1",
      merchantSku: "HBV1",
      productName: "Portal Ürün",
      brand: "Portal Marka",
      categoryName: "Portal Kategori",
    }),
  ]);
  assert.equal(result.matched, 1);
  assert.equal(db.state.products[0].product_name, "Portal Ürün");
  assert.equal(db.state.products[0].product_name_source, "HB_SELLER_PORTAL_EXPORT");
});

test("Hepsiburada Seller Portal readiness 30 gun stale ve Excel disi aktif urun uyarisi verir", async () => {
  const db = fakeDb(
    [
      product({
        hb_sku: "HBV1",
        merchant_sku: "HBV1",
        product_name: "Hazır Ürün",
      }),
      product({
        hb_sku: "HBV2",
        merchant_sku: "HBV2",
        product_name: "",
      }),
    ],
    {
      metadata: [["HBV1", { hb_sku: "HBV1" }]],
      imports: [
        {
          id: 1,
          filename: "old.xlsx",
          file_sha256: "hash",
          imported_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
          rows_total: 1,
          rows_active_in_excel: 1,
          matched: 1,
          updated: 1,
          summary_json: {},
        },
      ],
    },
  );
  const service = new HepsiburadaSellerPortalMetadataService({ db });
  const readiness = await service.readiness();
  assert.equal(readiness.stale, true);
  assert.equal(readiness.activeMissingMetadata, 1);
  assert.equal(readiness.activeNotInLatestExcel, 1);
});
