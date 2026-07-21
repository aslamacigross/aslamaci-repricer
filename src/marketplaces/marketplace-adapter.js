const {
  OPERATION_CAPABILITIES,
  normalizeCapabilities,
} = require("./capabilities");

const MARKETPLACE_RESULT_CODES = Object.freeze({
  CAPABILITY_NOT_SUPPORTED: "CAPABILITY_NOT_SUPPORTED",
  CREDENTIALS_MISSING: "MARKETPLACE_CREDENTIALS_MISSING",
  DISABLED: "MARKETPLACE_DISABLED",
  ADAPTER_NOT_READY: "MARKETPLACE_ADAPTER_NOT_READY",
});

function result(code, message, extra = {}) {
  return {
    ok: false,
    code,
    message,
    ...extra,
  };
}

class MarketplaceAdapter {
  constructor({ code, status = "SKELETON", capabilities = {} }) {
    this.code = code;
    this.status = status;
    this.capabilities = normalizeCapabilities(capabilities);
  }

  configured() {
    return false;
  }

  getCapabilities() {
    return { ...this.capabilities };
  }

  supports(operation) {
    const capability = OPERATION_CAPABILITIES[operation];
    return capability ? this.capabilities[capability] === true : true;
  }

  unsupported(operation) {
    return result(
      MARKETPLACE_RESULT_CODES.CAPABILITY_NOT_SUPPORTED,
      `${this.code} adaptörü ${operation} yeteneğini desteklemiyor`,
      { marketplace: this.code, operation },
    );
  }

  credentialsMissing(operation) {
    return result(
      MARKETPLACE_RESULT_CODES.CREDENTIALS_MISSING,
      `${this.code} kimlik bilgileri yapılandırılmamış`,
      { marketplace: this.code, operation },
    );
  }

  async testConnection() {
    return this.credentialsMissing("testConnection");
  }

  async execute(operation, input = {}) {
    if (!this.supports(operation)) return this.unsupported(operation);
    if (!this.configured()) return this.credentialsMissing(operation);
    if (typeof this[operation] !== "function") return this.unsupported(operation);
    return this[operation](input);
  }
}

module.exports = {
  MarketplaceAdapter,
  MARKETPLACE_RESULT_CODES,
  marketplaceResult: result,
};
