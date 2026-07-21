const MARKETPLACE_CAPABILITIES = Object.freeze([
  "supportsCatalogSearch",
  "supportsCatalogProductRead",
  "supportsExistingCatalogOfferCreate",
  "supportsNewProductCreate",
  "supportsCategorySync",
  "supportsAttributeSync",
  "supportsBrandSync",
  "supportsCommissionApi",
  "supportsBuybox",
  "supportsContentUpdate",
  "supportsImageUpdate",
  "supportsVideo",
  "supportsOrders",
  "supportsFinancialTransactions",
  "supportsPriceUpdate",
  "supportsInventoryUpdate",
  "supportsBatchStatus",
  "supportsListingVerification",
]);

const OPERATION_CAPABILITIES = Object.freeze({
  syncCategories: "supportsCategorySync",
  syncCategoryAttributes: "supportsAttributeSync",
  syncBrands: "supportsBrandSync",
  searchCatalog: "supportsCatalogSearch",
  getCatalogProduct: "supportsCatalogProductRead",
  matchExistingCatalogProduct: "supportsCatalogSearch",
  createProduct: "supportsNewProductCreate",
  createOfferOnExistingCatalogProduct: "supportsExistingCatalogOfferCreate",
  updateProductContent: "supportsContentUpdate",
  updatePriceAndInventory: "supportsPriceUpdate",
  fetchOrders: "supportsOrders",
  fetchCommissions: "supportsCommissionApi",
  fetchBuybox: "supportsBuybox",
  fetchFinancialTransactions: "supportsFinancialTransactions",
  getBatchResult: "supportsBatchStatus",
  verifyPublishedListing: "supportsListingVerification",
});

function normalizeCapabilities(input = {}) {
  return Object.fromEntries(
    MARKETPLACE_CAPABILITIES.map((key) => [key, input[key] === true]),
  );
}

module.exports = {
  MARKETPLACE_CAPABILITIES,
  OPERATION_CAPABILITIES,
  normalizeCapabilities,
};
