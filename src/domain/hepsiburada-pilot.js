const crypto = require("crypto");
const { env } = require("../config/env");
const { AppError } = require("../utils/errors");
const {
  merchantId,
  matchesOwnListing,
} = require("./hepsiburada-merchant-identity");
const STRICT_SOURCE = "HEPSIBURADA_OFFICIAL_API:STRICT:";
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const hash = (value) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const exact = (value) =>
  typeof value === "string" && value.length > 0 && value === value.trim();

// No names, aliases or logistics identifiers confer pilot authority. An invalid
// configuration closes the pilot; [] never means all products.
class HepsiburadaPilotPolicy {
  constructor(config = () => env) {
    this.config = config;
  }
  snapshot() {
    const c = this.config();
    const id = merchantId(c.hepsiburadaMerchantId);
    let entries;
    try {
      entries =
        typeof c.hepsiburadaPilotAllowlist === "string"
          ? JSON.parse(c.hepsiburadaPilotAllowlist)
          : (c.hepsiburadaPilotAllowlist ?? []);
      if (!Array.isArray(entries) || entries.length > 3)
        throw new Error("limit");
      const keys = new Set();
      entries = entries
        .map((e) => {
          if (
            !e ||
            e.marketplace !== "HEPSIBURADA" ||
            !exact(e.merchantId) ||
            merchantId(e.merchantId) !== id ||
            !id ||
            !exact(e.merchantSku) ||
            !exact(e.hbSku) ||
            typeof e.identity !== "boolean" ||
            typeof e.floorRecovery !== "boolean"
          )
            throw new Error("identity");
          const row = {
            marketplace: e.marketplace,
            merchantId: id,
            merchantSku: e.merchantSku,
            hbSku: e.hbSku,
            identity: e.identity,
            floorRecovery: e.floorRecovery,
          };
          const key = JSON.stringify([id, row.merchantSku, row.hbSku]);
          if (keys.has(key)) throw new Error("duplicate");
          keys.add(key);
          return row;
        })
        .sort((a, b) =>
          JSON.stringify(a) < JSON.stringify(b)
            ? -1
            : JSON.stringify(a) > JSON.stringify(b)
              ? 1
              : 0,
        );
    } catch {
      entries = [];
    }
    const identityEnabled = c.hepsiburadaStrictMerchantIdentityEnabled === true;
    const floorEnabled = c.hepsiburadaFloorRecoveryEnabled === true;
    return {
      entries,
      identityEnabled,
      floorEnabled,
      revision: hash({ id, entries, identityEnabled, floorEnabled }),
      identityRevision: hash({
        id,
        identityEnabled,
        entries: entries
          .filter((e) => e.identity)
          .map(({ merchantId, merchantSku, hbSku }) => ({
            merchantId,
            merchantSku,
            hbSku,
          })),
      }),
    };
  }
  scope(product, feature) {
    const s = this.snapshot();
    const entry =
      product?.marketplace === "HEPSIBURADA" &&
      s.entries.find(
        (e) =>
          e.merchantSku === product.merchant_sku && e.hbSku === product.hb_sku,
      );
    const allowed = Boolean(
      entry &&
      (feature === "identity"
        ? s.identityEnabled && entry.identity
        : s.floorEnabled && entry.floorRecovery),
    );
    return {
      allowed,
      revision: s.revision,
      identityRevision: s.identityRevision,
      entry: entry || null,
    };
  }
  identitySource(product) {
    const s = this.scope(product, "identity");
    return s.allowed ? STRICT_SOURCE + s.identityRevision : null;
  }
  proof(product, { floor = false } = {}) {
    const identity = this.scope(product, "identity");
    if (product.buybox_error_code === "HB_MERCHANT_IDENTITY_CONFLICT")
      throw new AppError(
        "Provider satıcı kimliği çelişkili",
        409,
        "HB_MERCHANT_IDENTITY_CONFLICT",
      );
    const floorScope = this.scope(product, "floorRecovery");
    if (
      String(product.buybox_source || "").startsWith(STRICT_SOURCE) &&
      product.buybox_source !== this.identitySource(product)
    )
      throw new AppError(
        "Strict kimlik kanıtı güncel pilot kapsamında değil",
        409,
        "HB_IDENTITY_SCOPE_REVOKED",
      );
    if (
      identity.allowed &&
      product.buybox_source !== this.identitySource(product)
    )
      throw new AppError(
        "Güncel strict kimlik gözlemi gerekli",
        409,
        "HB_IDENTITY_EVIDENCE_STALE",
      );
    if (floor && !floorScope.allowed)
      throw new AppError(
        "SKU floor pilot kapsamında değil",
        409,
        "HB_PILOT_SCOPE_DENIED",
      );
    if (!identity.allowed && !floor) return null;
    const entry = (floor ? floorScope : identity).entry;
    return {
      version: "HB_PILOT_V1",
      revision: identity.revision,
      marketplace: entry.marketplace,
      merchantId: entry.merchantId,
      merchantSku: entry.merchantSku,
      hbSku: entry.hbSku,
      features: { identity: identity.allowed, floorRecovery: floor },
    };
  }
  matchesListing(product, listing, proof) {
    if (
      !matchesOwnListing(product, listing) ||
      !proof ||
      proof.merchantId !== merchantId(this.config().hepsiburadaMerchantId) ||
      proof.merchantSku !== product.merchant_sku ||
      proof.hbSku !== product.hb_sku
    )
      return false;
    // Merchant-authenticated GET need not echo a seller ID. When it does, a
    // conflicting permanent ID always vetoes otherwise matching SKU strings.
    return [listing.merchantId, listing.sellerId].every(
      (id) => id == null || merchantId(id) === proof.merchantId,
    );
  }

  assertAction(action, product) {
    if (!product)
      throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
    // Explicit manual pricing remains its own existing authorization path; it
    // does not inherit permission from a pilot observation or old pilot proof.
    if (
      ["MANUAL", "MANUAL_EDIT", "ROLLBACK"].includes(action.source) &&
      !action.safety_checks?.hbPilot &&
      !action.safety_checks?.hbFloorRecovery
    )
      return null;
    const saved = action.safety_checks?.hbPilot;
    const floor = Boolean(action.safety_checks?.hbFloorRecovery);
    const proof = this.proof(product, { floor });
    if (saved || floor || proof) {
      if (!saved || hash(saved) !== hash(proof))
        throw new AppError(
          "Pilot kapsamı veya kimliği değişti; yeni preview gerekli",
          409,
          "HB_PILOT_STALE",
        );
    }
    return proof;
  }
}
module.exports = { HepsiburadaPilotPolicy, STRICT_SOURCE };
