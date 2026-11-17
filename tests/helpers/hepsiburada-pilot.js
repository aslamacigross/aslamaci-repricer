const {
  HepsiburadaPilotPolicy,
} = require("../../src/domain/hepsiburada-pilot");
const {
  evidenceFromResponse,
} = require("../../src/domain/hepsiburada-commission-evidence");
// Synthetic, explicitly VAT-inclusive provider response. Never live tax evidence.
function testCommission(product, options = {}) {
  const scope = {
    merchantId: "test-merchant",
    merchantSku: product.merchant_sku || product.barcode,
    hbSku: product.hb_sku || product.marketplace_product_id,
  };
  return evidenceFromResponse(
    [
      {
        sku: scope.hbSku,
        merchantSku: scope.merchantSku,
        commissionRate: Number(product.commission_rate ?? 17),
        commissionVatIncluded: true,
      },
    ],
    scope,
    options.now ?? Date.now(),
  );
}
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
module.exports = { testPilot, testCommission };
