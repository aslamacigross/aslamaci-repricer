const {
  MARKETPLACE_RESULT_CODES,
  marketplaceResult,
} = require("../marketplaces/marketplace-adapter");

function safeErrorSummary(error) {
  return String(error?.message || "Bağlantı doğrulanamadı")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]")
    .replace(
      /(authorization|api[-_ ]?key|secret|password|token)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 400);
}

class MarketplaceRegistryService {
  constructor({ repository, adapters = {} }) {
    this.repository = repository;
    this.adapters = new Map(
      Object.entries(adapters).map(([code, adapter]) => [
        code.toUpperCase(),
        adapter,
      ]),
    );
  }

  adapter(code) {
    return this.adapters.get(String(code || "").toUpperCase());
  }

  present(record) {
    const adapter = this.adapter(record.code);
    const configured = Boolean(adapter?.configured?.());
    return {
      ...record,
      enabled: record.enabled === true,
      configured,
      credentials_configured: configured,
      credentials_status: configured ? "CONFIGURED" : "MISSING",
      adapter_status: adapter?.status || record.adapter_status,
      capabilities: adapter?.getCapabilities?.() || record.capabilities || {},
    };
  }

  async list() {
    return (await this.repository.list()).map((record) => this.present(record));
  }

  async get(code) {
    const record = await this.repository.get(code);
    return record ? this.present(record) : null;
  }

  async testConnection(code) {
    const record = await this.get(code);
    if (!record)
      return marketplaceResult(
        "MARKETPLACE_NOT_FOUND",
        "Pazaryeri bulunamadı",
        { marketplace: String(code || "").toUpperCase() },
      );
    if (!record.enabled) {
      const outcome = marketplaceResult(
        MARKETPLACE_RESULT_CODES.DISABLED,
        `${record.display_name} entegrasyonu devre dışı`,
        { marketplace: record.code },
      );
      await this.repository.recordConnection(record.code, {
        ok: false,
        credentialsStatus: record.credentials_status,
        adapterStatus: record.adapter_status,
        errorCode: outcome.code,
        errorSummary: outcome.message,
      });
      return outcome;
    }
    const adapter = this.adapter(record.code);
    if (!adapter || adapter.status === "SKELETON") {
      const outcome = await adapter?.testConnection?.();
      return (
        outcome ||
        marketplaceResult(
          MARKETPLACE_RESULT_CODES.ADAPTER_NOT_READY,
          `${record.display_name} adaptörü hazır değil`,
          { marketplace: record.code },
        )
      );
    }
    if (!adapter.configured()) {
      const outcome = adapter.credentialsMissing("testConnection");
      await this.repository.recordConnection(record.code, {
        ok: false,
        credentialsStatus: "MISSING",
        adapterStatus: adapter.status,
        errorCode: outcome.code,
        errorSummary: outcome.message,
      });
      return outcome;
    }
    try {
      const outcome = await adapter.testConnection();
      await this.repository.recordConnection(record.code, {
        ok: outcome.ok === true,
        credentialsStatus: "CONFIGURED",
        adapterStatus: adapter.status,
        errorCode: outcome.ok ? null : outcome.code,
        errorSummary: outcome.ok ? null : outcome.message,
      });
      return outcome;
    } catch (error) {
      const summary = safeErrorSummary(error);
      const outcome = marketplaceResult(
        "MARKETPLACE_CONNECTION_FAILED",
        summary,
        { marketplace: record.code },
      );
      await this.repository.recordConnection(record.code, {
        ok: false,
        credentialsStatus: "CONFIGURED",
        adapterStatus: adapter.status,
        errorCode: outcome.code,
        errorSummary: summary,
      });
      return outcome;
    }
  }

  async execute(code, operation, input = {}) {
    const record = await this.get(code);
    if (!record)
      return marketplaceResult("MARKETPLACE_NOT_FOUND", "Pazaryeri bulunamadı");
    if (!record.enabled)
      return marketplaceResult(
        MARKETPLACE_RESULT_CODES.DISABLED,
        `${record.display_name} entegrasyonu devre dışı`,
        { marketplace: record.code, operation },
      );
    const adapter = this.adapter(record.code);
    if (!adapter || adapter.status === "SKELETON")
      return marketplaceResult(
        MARKETPLACE_RESULT_CODES.ADAPTER_NOT_READY,
        `${record.display_name} adaptörü hazır değil`,
        { marketplace: record.code, operation },
      );
    return adapter.execute(operation, input);
  }

  resolveListingIdentifiers(code, input = {}) {
    const adapter = this.adapter(code);
    if (!adapter?.resolveListingIdentifiers)
      return {
        marketplaceProductId: null,
        marketplaceCatalogBarcode: null,
        sellerListingBarcode: null,
        sellerSku: null,
        externalListingId: null,
        semanticsVerified: false,
      };
    return adapter.resolveListingIdentifiers(input);
  }

  async runJob(code, operation, input = {}) {
    const outcome = await this.execute(code, operation, input);
    if (outcome?.ok === false) {
      const skippedByCode = {
        [MARKETPLACE_RESULT_CODES.CREDENTIALS_MISSING]:
          "SKIPPED_CREDENTIALS_MISSING",
        [MARKETPLACE_RESULT_CODES.DISABLED]: "SKIPPED_MARKETPLACE_DISABLED",
        [MARKETPLACE_RESULT_CODES.ADAPTER_NOT_READY]:
          "SKIPPED_ADAPTER_NOT_READY",
        [MARKETPLACE_RESULT_CODES.CAPABILITY_NOT_SUPPORTED]:
          "SKIPPED_CAPABILITY_NOT_SUPPORTED",
      };
      return {
        status: skippedByCode[outcome.code] || "FAILED",
        processed: 0,
        successful: 0,
        failed: 0,
        metadata: { marketplace: code, operation, code: outcome.code },
      };
    }
    return {
      status: "SUCCESS",
      processed: Number(outcome?.processed || 0),
      successful: Number(outcome?.successful || outcome?.processed || 0),
      failed: Number(outcome?.failed || 0),
      metadata: { marketplace: code, operation },
    };
  }
}

module.exports = { MarketplaceRegistryService, safeErrorSummary };
