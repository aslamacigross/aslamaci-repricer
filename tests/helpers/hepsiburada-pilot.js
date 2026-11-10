const {
  HepsiburadaPilotPolicy,
} = require("../../src/domain/hepsiburada-pilot");
function testPilot(product, flags = {}) {
  const config = {
    hepsiburadaMerchantId: "test-merchant",
    hepsiburadaStrictMerchantIdentityEnabled: false,
    hepsiburadaFloorRecoveryEnabled: true,
    hepsiburadaPilotAllowlist: [
      {
        marketplace: "HEPSIBURADA",
        merchantId: "test-merchant",
        merchantSku: product.merchant_sku || product.barcode,
        hbSku: product.hb_sku || product.marketplace_product_id,
        identity: false,
        floorRecovery: true,
      },
    ],
    ...flags,
  };
  return { config, pilot: new HepsiburadaPilotPolicy(() => config) };
}
module.exports = { testPilot };
