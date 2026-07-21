const path = require("path");

require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

function bool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "evet"].includes(String(value).toLowerCase());
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: number(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL || "",
  trendyolApiKey: process.env.TY_API_KEY || "",
  trendyolApiSecret: process.env.TY_API_SECRET || "",
  trendyolSupplierId: process.env.TY_SUPPLIER_ID || "",
  trendyolStorefrontCode: process.env.TY_STOREFRONT_CODE || "TR",
  hepsiburadaEnv: (
    process.env.HEPSIBURADA_ENV ||
    process.env.HB_ENV ||
    "production"
  ).toLowerCase(),
  hepsiburadaMerchantId: process.env.HB_MERCHANT_ID || "",
  hepsiburadaUsername: process.env.HB_USERNAME || "",
  hepsiburadaPassword: process.env.HB_PASSWORD || "",
  hepsiburadaIntegratorKey: process.env.HB_INTEGRATOR_KEY || "",
  hepsiburadaUserAgent:
    process.env.HEPSIBURADA_USER_AGENT || process.env.HB_USER_AGENT || "",
  hepsiburadaOrderBaseUrl:
    process.env.HB_ORDER_BASE_URL ||
    process.env.HEPSIBURADA_ORDER_BASE_URL ||
    "",
  hepsiburadaListingBaseUrl:
    process.env.HB_LISTING_BASE_URL ||
    process.env.HEPSIBURADA_LISTING_BASE_URL ||
    "",
  hepsiburadaProductBaseUrl:
    process.env.HB_PRODUCT_BASE_URL ||
    process.env.HEPSIBURADA_PRODUCT_BASE_URL ||
    "",
  hepsiburadaMutationsEnabled: bool(
    process.env.HEPSIBURADA_MUTATIONS_ENABLED ||
      process.env.HB_MUTATIONS_ENABLED,
    false,
  ),
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "change-me",
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || "",
  sessionSecret:
    process.env.SESSION_SECRET || "local-development-session-secret-only",
  allowedOrigin: process.env.ALLOWED_ORIGIN || "",
  dryRun: bool(process.env.DRY_RUN, true),
  repricerEnabled: bool(process.env.REPRICER_ENABLED, false),
  jobsEnabled: bool(process.env.JOBS_ENABLED, true),
  defaultCarrier: process.env.DEFAULT_CARRIER || "TEX",
  defaultServiceFee: number(process.env.DEFAULT_SERVICE_FEE, 13.19),
  defaultTargetProfit: number(process.env.DEFAULT_TARGET_PROFIT, 40),
  defaultMaxIncrease: number(process.env.DEFAULT_MAX_INCREASE_TL, 10),
  buyboxMaxAgeMinutes: number(process.env.BUYBOX_MAX_AGE_MINUTES, 20),
  globalMaxPriceChangePct: number(process.env.GLOBAL_MAX_PRICE_CHANGE_PCT, 15),
  globalMaxDailyDecreasePct: number(
    process.env.GLOBAL_MAX_DAILY_DECREASE_PCT,
    5,
  ),
  minPriceChangeTl: number(process.env.MIN_PRICE_CHANGE_TL, 0.1),
  logRetentionDays: number(process.env.LOG_RETENTION_DAYS, 90),
  skipMigrations: bool(process.env.SKIP_MIGRATIONS, false),
  productPublishingEnabled: bool(process.env.PRODUCT_PUBLISHING_ENABLED, false),
  contentAutoUpdateEnabled: bool(
    process.env.CONTENT_AUTO_UPDATE_ENABLED,
    false,
  ),
  opportunityAutoPublishEnabled: bool(
    process.env.OPPORTUNITY_AUTO_PUBLISH_ENABLED,
    false,
  ),
};

function validateEnv() {
  const errors = [];
  if (env.nodeEnv === "production") {
    if (!env.databaseUrl) errors.push("DATABASE_URL zorunlu");
    if (
      !env.adminPasswordHash &&
      (env.adminPassword === "change-me" || env.adminPassword.length < 12)
    ) {
      errors.push("ADMIN_PASSWORD production icin en az 12 karakter olmali");
    }
    if (
      env.adminPasswordHash &&
      !/^[a-f0-9]+:[a-f0-9]+$/i.test(env.adminPasswordHash)
    )
      errors.push("ADMIN_PASSWORD_HASH formati gecersiz");
    if (env.sessionSecret.length < 32)
      errors.push("SESSION_SECRET en az 32 karakter olmali");
  }
  if (env.opportunityAutoPublishEnabled)
    errors.push("OPPORTUNITY_AUTO_PUBLISH_ENABLED false kalmali");
  if (!["sit", "test", "production", "prod"].includes(env.hepsiburadaEnv))
    errors.push("HEPSIBURADA_ENV sit veya production olmali");
  if (env.hepsiburadaMutationsEnabled)
    errors.push("HEPSIBURADA_MUTATIONS_ENABLED false kalmali");
  if (errors.length)
    throw new Error(`Environment validation failed: ${errors.join("; ")}`);
}

module.exports = { env, validateEnv, bool, number };
