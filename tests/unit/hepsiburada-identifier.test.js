const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hepsiburadaVerifiedCatalogGtin,
} = require("../../src/services/sync.service");

test("merchant SKU ve belirsiz barkod alanlari dogrulanmis GTIN sayilmaz", () => {
  assert.deepEqual(
    hepsiburadaVerifiedCatalogGtin({
      merchantSku: "8690000000012",
      merchantBarcode: "8690000000012",
      barcode: "8690000000012",
      sku: "8690000000012",
    }),
    { gtin: "", source: "" },
  );
});

test("acik ean API alani gecerli checksum ile kaynakli GTIN olur", () => {
  assert.deepEqual(hepsiburadaVerifiedCatalogGtin({ ean: "8690000000012" }), {
    gtin: "8690000000012",
    source: "HEPSIBURADA_CATALOG_API:ean",
  });
});
