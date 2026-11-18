const crypto = require("crypto");
const { env } = require("../config/env");
const { AppError } = require("../utils/errors");
const {
  cashSnapshot,
  cashFloorScenario,
  commissionCash,
  cashContribution,
} = require("../domain/hepsiburada-commission-cash");
const {
  matchesOwnListing,
  merchantId,
} = require("../domain/hepsiburada-merchant-identity");
const { MAX_AGE_MS } = require("../domain/hepsiburada-commission-evidence");
const {
  selectShippingCost,
  calculateMinimumPrice,
  calculateNetProfit,
  calculateNetMargin,
} = require("../domain/pricing");

const VERSION = "HB_CASH_RUNTIME_V1";
const hash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const exact = (s) => typeof s === "string" && s.length > 0 && s === s.trim();
function requireCash(ok, code) {
  if (!ok) throw new AppError(code, 409, code);
}
function json(value, fallback) {
  return typeof value === "string" ? JSON.parse(value) : (value ?? fallback);
}

class HepsiburadaCashEconomyService {
  constructor({
    db,
    hepsiburada,
    floor,
    config = () => env,
    now = () => Date.now(),
  }) {
    Object.assign(this, { db, hepsiburada, floor, config, now });
  }
  policy() {
    const c = this.config();
    const mode = c.hepsiburadaCashEconomyMode || "OFF";
    requireCash(
      ["OFF", "SHADOW", "ENFORCE"].includes(mode),
      "HB_CASH_MODE_INVALID",
    );
    if (mode === "OFF") return { mode, entries: [], revision: hash({ mode }) };
    let entries, contract;
    try {
      entries = json(c.hepsiburadaCashAllowlist, []);
      contract = json(c.hepsiburadaCashContract, null);
    } catch {
      throw new AppError(
        "HB cash configuration invalid",
        409,
        "HB_CASH_CONFIG_INVALID",
      );
    }
    const id = merchantId(c.hepsiburadaMerchantId);
    requireCash(
      Array.isArray(entries) && entries.length <= 3,
      "HB_CASH_SCOPE_INVALID",
    );
    const keys = new Set();
    for (const row of entries) {
      requireCash(
        row?.marketplace === "HEPSIBURADA" &&
          id &&
          row.merchantId === id &&
          exact(row.merchantSku) &&
          exact(row.hbSku),
        "HB_CASH_SCOPE_INVALID",
      );
      const key = JSON.stringify([id, row.merchantSku, row.hbSku]);
      requireCash(!keys.has(key), "HB_CASH_SCOPE_INVALID");
      keys.add(key);
    }
    // A declared all-worker protocol is an operator rollout precondition, NOT
    // proof of fencing or an exactly-once provider guarantee.
    if (mode === "ENFORCE")
      requireCash(
        c.hepsiburadaCashWorkerProtocol === VERSION,
        "HB_CASH_WORKER_PROTOCOL_REQUIRED",
      );
    return {
      mode,
      entries,
      contract,
      merchantId: id,
      revision: hash({
        mode,
        entries,
        contract,
        protocol: c.hepsiburadaCashWorkerProtocol || null,
      }),
    };
  }
  scope(product, policy = this.policy()) {
    return (
      product.marketplace === "HEPSIBURADA" &&
      policy.entries.some(
        (e) =>
          e.merchantSku === product.merchant_sku && e.hbSku === product.hb_sku,
      )
    );
  }
  legacy(product) {
    const input = {
      salePrice: product.my_price,
      productCost: product.calculated_product_cost,
      shippingCost: product.calculated_shipping_cost,
      packagingCost: product.packaging_cost,
      serviceFee: product.service_fee,
      commissionRate: product.commission_rate,
      targetProfit: product.target_profit,
    };
    return {
      min_price: calculateMinimumPrice(input),
      calculated_min_price: calculateMinimumPrice(input),
      calculated_net_profit: calculateNetProfit(input),
      calculated_net_margin: calculateNetMargin(input),
      calculated_product_cost: product.calculated_product_cost,
      calculated_shipping_cost: product.calculated_shipping_cost,
      packaging_cost: product.packaging_cost,
      service_fee: product.service_fee,
    };
  }
  verifyQuote(product, quote) {
    const p = this.policy(),
      s = product.hb_cash_economics;
    requireCash(s && this.scope(product, p), "HB_CASH_PREVIEW_REQUIRED");
    cashSnapshot({
      product,
      quote,
      configuredMerchantId: p.merchantId,
      contract: p.contract,
      base: {
        source: "PROVIDER_OWN_LISTING",
        merchantId: p.merchantId,
        merchantSku: product.merchant_sku,
        hbSku: product.hb_sku,
        amount: Number(product.my_price),
        checkedAt: s.checkedAt,
      },
      money: {
        buyerRevenue: Number(product.my_price),
        hbFundedDiscount: 0,
        productCost: Number(product.calculated_product_cost),
        shippingCost: Number(product.calculated_shipping_cost),
        packagingCost: Number(product.packaging_cost),
        serviceFee: Number(product.service_fee),
        otherVerifiedCosts: s.otherVerifiedCosts,
      },
      now: this.now(),
    });
    return {
      ...quote,
      fingerprint: hash({
        version: VERSION,
        merchantId: quote.merchantId,
        merchantSku: quote.merchantSku,
        hbSku: quote.hbSku,
        rate: quote.rate,
        contract: p.revision,
      }),
    };
  }
  // Read remote evidence before an owned bulk cache transaction acquires any
  // product row locks. A caller already inside a transaction keeps ownership.
  async preload(rows) {
    const policy = this.policy(),
      reads = new Map();
    requireCash(rows.length <= 3, "HB_CASH_SCOPE_AMBIGUOUS");
    for (const row of rows) {
      if (!this.scope(row, policy)) continue;
      const key = JSON.stringify([row.merchant_sku, row.hb_sku]);
      try {
        const quote = await this.hepsiburada.readCommissionForPrice({
          merchantSku: row.merchant_sku,
          hbSku: row.hb_sku,
        });
        const listing = await this.hepsiburada.readListingForPrice({
          merchantSku: row.merchant_sku,
          hbSku: row.hb_sku,
        });
        requireCash(quote && listing, "HB_CASH_MARKET_EVIDENCE_UNAVAILABLE");
        reads.set(key, {
          quote,
          listing,
          listingCheckedAt: new Date(this.now()).toISOString(),
        });
      } catch (error) {
        reads.set(key, { error });
      }
    }
    requireCash(
      this.policy().revision === policy.revision,
      "HB_CASH_POLICY_CHANGED",
    );
    return reads;
  }
  async observe(
    product,
    {
      queryable = this.db,
      listing,
      quote,
      listingCheckedAt,
      actionId = null,
    } = {},
  ) {
    const policy = this.policy();
    if (!this.scope(product, policy)) return null;
    requireCash(product.data_complete, "HB_CASH_COST_INCOMPLETE");
    const contract = policy.contract;
    const profiles = Array.isArray(contract?.expenseEvidence)
      ? contract.expenseEvidence
      : [contract?.expenseEvidence];
    const matchedExpenses = profiles.filter(
      (e) =>
        e?.merchantId === policy.merchantId &&
        e?.merchantSku === product.merchant_sku &&
        e?.hbSku === product.hb_sku,
    );
    const expense = matchedExpenses.length === 1 && matchedExpenses[0];
    requireCash(
      expense?.source === "HB_REVIEWED_EXPENSE_PROFILE" &&
        expense.merchantId === policy.merchantId &&
        exact(expense.revision) &&
        this.now() >= Date.parse(expense.checkedAt) &&
        this.now() - Date.parse(expense.checkedAt) <= 24 * 60 * 60 * 1000 &&
        expense.otherCostsKnown === true &&
        Number.isFinite(expense.otherVerifiedCosts) &&
        expense.otherVerifiedCosts >= 0,
      "HB_CASH_EXPENSE_UNVERIFIED",
    );
    // No unallocated campaign/return credit can lower the pricing floor.
    // The HB product schema does not persist a trustworthy campaign/base proof.
    // Require a separately reviewed, exact SKU observation; do not invent API
    // VAT/discount fields or treat absent campaign data as zero.
    const bases = contract?.pricingBaseEvidence;
    const baseProof =
      Array.isArray(bases) &&
      bases.filter(
        (b) =>
          b.merchantId === policy.merchantId &&
          b.merchantSku === product.merchant_sku &&
          b.hbSku === product.hb_sku,
      );
    const baseEvidence = baseProof?.length === 1 && baseProof[0];
    requireCash(
      baseEvidence?.source === "HB_REVIEWED_SKU_BASE" &&
        exact(baseEvidence.revision) &&
        baseEvidence.rule === "LISTING_PRICE_NO_CAMPAIGN" &&
        baseEvidence.sellerFundedDiscount === 0 &&
        baseEvidence.hbFundedDiscount === 0 &&
        this.now() >= Date.parse(baseEvidence.checkedAt) &&
        this.now() - Date.parse(baseEvidence.checkedAt) <= MAX_AGE_MS,
      "HB_CASH_CAMPAIGN_BASE_UNVERIFIED",
    );
    quote =
      quote ||
      (await this.hepsiburada.readCommissionForPrice({
        merchantSku: product.merchant_sku,
        hbSku: product.hb_sku,
      }));
    listing =
      listing ||
      (await this.hepsiburada.readListingForPrice({
        merchantSku: product.merchant_sku,
        hbSku: product.hb_sku,
      }));
    requireCash(
      matchesOwnListing(product, listing) &&
        [listing?.merchantId, listing?.sellerId].every(
          (id) => id == null || merchantId(id) === policy.merchantId,
        ),
      "HB_CASH_IDENTITY_UNVERIFIED",
    );
    const ownPrice = Number(
      listing?.price?.amount ??
        listing?.price?.value ??
        listing?.price ??
        listing?.salePrice,
    );
    requireCash(
      Number.isFinite(ownPrice) && ownPrice === Number(product.my_price),
      "MARKET_PRICE_MISMATCH",
    );
    const batch = await this.floor.loadBatch([product], queryable, actionId);
    // Open-action gating is owned by generation/approval/executor. Valuation
    // must still refresh a cost while its own action is open.
    const verified = this.floor.verifyCost(
      product,
      { ...batch, open: [] },
      quote,
      {
        verifyCommission: (evidence) => {
          // cashSnapshot below validates source, merchant/SKU, freshness, contract,
          // rate and VAT meaning together. Never claim UNKNOWN provider VAT=true.
          requireCash(
            evidence?.rate === Number(product.commission_rate),
            "HB_CASH_RATE_CHANGED",
          );
          return evidence;
        },
      },
    );
    const money = {
      buyerRevenue: ownPrice,
      hbFundedDiscount: 0,
      productCost: verified.cost,
      shippingCost: Number(product.calculated_shipping_cost),
      packagingCost: Number(product.packaging_cost),
      serviceFee: Number(product.service_fee),
      otherVerifiedCosts: expense.otherVerifiedCosts,
    };
    const snapshot = cashSnapshot({
      product,
      quote,
      configuredMerchantId: policy.merchantId,
      contract,
      base: {
        source: "PROVIDER_OWN_LISTING",
        merchantId: policy.merchantId,
        merchantSku: product.merchant_sku,
        hbSku: product.hb_sku,
        amount: ownPrice,
        checkedAt: listingCheckedAt || new Date(this.now()).toISOString(),
      },
      money,
      now: this.now(),
    });
    const floor = cashFloorScenario({
      money: {
        ...money,
        commissionRate: quote.rate,
        targetProfit: Math.max(
          Number(product.target_profit || 0),
          Number(
            product.settings?.minimum_profit_tl ||
              product.minimum_profit_tl ||
              0,
          ),
        ),
      },
      minimum: Number(
        product.settings?.minimum_price || product.minimum_price || 0,
      ),
      current: 0,
      desi: verified.desi,
      carrier: batch.carrier,
      barems: batch.barems,
      rates: batch.rates,
      commissionBaseRule: contract.commissionBase,
      vatBasis: contract.rateBasis,
      vatRate: contract.vatEvidence.rate,
      roundingProfile: contract.roundingProfile,
    });
    const commissionModel = {
      version: VERSION,
      vatBasis: contract.rateBasis,
      vatRate: contract.vatEvidence.rate,
      roundingProfile: contract.roundingProfile,
    };
    const inputs = {
      snapshot: snapshot.fingerprint,
      policy: policy.revision,
      mappings: batch.mappings,
      rates: batch.rates,
      barems: batch.barems,
      expenses: batch.expenses,
      minimumServiceFee: batch.minimumServiceFee,
      product: Object.fromEntries(
        [
          "marketplace",
          "barcode",
          "merchant_sku",
          "hb_sku",
          "my_price",
          "commission_rate",
          "desi",
          "manual_desi_override",
          "calculated_product_cost",
          "calculated_shipping_cost",
          "packaging_cost",
          "service_fee",
          "target_profit",
          "stock_quantity",
          "is_active",
          "on_sale",
          "auto_update",
          "locked",
        ].map((k) => [k, product[k]]),
      ),
      settings: Object.fromEntries(
        [
          "strategy",
          "mode",
          "auto_update",
          "minimum_profit_tl",
          "minimum_profit_pct",
          "minimum_margin_pct",
          "minimum_price",
          "maximum_price",
          "price_cut_tl",
          "max_single_change_pct",
          "max_daily_change_pct",
          "min_change_interval_minutes",
          "daily_action_limit",
          "blacklisted",
          "min_undercut_tl",
          "max_undercut_tl",
          "unlimited_increase",
        ].map((k) => [
          k,
          (product.cash_settings || product.settings
            ? (product.cash_settings || product.settings)[k]
            : k === "auto_update"
              ? product.setting_auto_update
              : product[k]) ?? null,
        ]),
      ),
    };
    requireCash(
      this.policy().revision === policy.revision,
      "HB_CASH_POLICY_CHANGED",
    );
    return {
      version: VERSION,
      mode: policy.mode,
      revision: policy.revision,
      evidence: { ...snapshot.evidence, skuBase: baseEvidence, expense },
      fingerprint: hash(inputs),
      checkedAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(this.now() + MAX_AGE_MS).toISOString(),
      identity: {
        merchantId: policy.merchantId,
        merchantSku: product.merchant_sku,
        hbSku: product.hb_sku,
      },
      originalRate: quote.rate,
      effectiveRate: quote.rate * (1 + contract.vatEvidence.rate / 100),
      commissionModel,
      commission: snapshot.evidence.commission,
      contribution: snapshot.contribution,
      minimum: floor.price,
      targetShipping: floor.shippingCost,
      legacy: this.legacy(product),
      pricingAuthorized: false,
      batch,
      otherVerifiedCosts: expense.otherVerifiedCosts,
    };
  }
  project(product, snapshot) {
    if (snapshot?.mode !== "ENFORCE")
      return { ...product, hb_cash_economics: snapshot };
    return {
      ...product,
      min_price: snapshot.minimum,
      calculated_min_price: snapshot.minimum,
      calculated_net_profit: snapshot.contribution,
      calculated_net_margin:
        Number(product.my_price) > 0
          ? Math.round(
              (snapshot.contribution / Number(product.my_price)) * 10000,
            ) / 100
          : 0,
      hb_cash_commission: snapshot.commissionModel,
      hb_cash_other_costs: snapshot.otherVerifiedCosts,
      hb_cash_economics: { ...snapshot, applied: true },
    };
  }
  async prepare(product, options) {
    if (product.marketplace !== "HEPSIBURADA") return product;
    const p = this.policy();
    if (!this.scope(product, p)) {
      requireCash(
        !product.hb_cash_economics?.applied,
        "HB_CASH_RECALC_REQUIRED",
      );
      return {
        ...product,
        hb_cash_economics: null,
        hb_cash_cached_economics: product.hb_cash_economics,
      };
    }
    requireCash(
      !(p.mode === "SHADOW" && product.hb_cash_economics?.applied),
      "HB_CASH_RECALC_REQUIRED",
    );
    return this.project(product, await this.observe(product, options));
  }
  proposal(product, proposal) {
    const s = product.hb_cash_economics;
    if (!s?.batch) return proposal;
    const shipping = selectShippingCost({
      salePrice: proposal.proposedPrice,
      desi: Number(product.desi),
      carrier: s.batch.carrier,
      barems: s.batch.barems,
      costs: s.batch.rates,
    });
    const commission = commissionCash({
      commissionBase: proposal.proposedPrice,
      skuRate: s.originalRate,
      ...s.commissionModel,
    });
    const profit = cashContribution({
      buyerRevenue: proposal.proposedPrice,
      hbFundedDiscount: 0,
      productCost: Number(product.calculated_product_cost),
      shippingCost: shipping,
      packagingCost: Number(product.packaging_cost),
      serviceFee: Number(product.service_fee),
      otherVerifiedCosts: s.otherVerifiedCosts,
      commission,
    });
    const comparison = {
      evidence: s.evidence,
      version: s.version,
      mode: s.mode,
      revision: s.revision,
      fingerprint: s.fingerprint,
      checkedAt: s.checkedAt,
      expiresAt: s.expiresAt,
      identity: s.identity,
      originalRate: s.originalRate,
      effectiveRate: s.effectiveRate,
      commission,
      cashMinimum: s.minimum,
      cashContribution: profit,
      legacy: s.legacy,
      targetShipping: shipping,
      pricingAuthorized: false,
    };
    return {
      ...proposal,
      economicComparison: comparison,
      ...(s.mode === "ENFORCE"
        ? {
            expectedProfit: profit,
            expectedMargin:
              proposal.proposedPrice > 0
                ? Math.round((profit / proposal.proposedPrice) * 10000) / 100
                : 0,
          }
        : {}),
    };
  }
  assertAction(action, product) {
    if (action.marketplace !== "HEPSIBURADA") return;
    const p = this.policy(),
      saved = action.safety_checks?.hbCash;
    if (!saved && !this.scope(product, p)) return;
    requireCash(
      saved &&
        this.scope(product, p) &&
        saved.version === VERSION &&
        saved.mode === p.mode &&
        saved.revision === p.revision,
      "HB_CASH_PREVIEW_REQUIRED",
    );
    const settings = product.cash_settings || product.settings || product;
    if (
      p.mode === "ENFORCE" &&
      !["MANUAL", "MANUAL_EDIT", "ROLLBACK"].includes(action.source)
    )
      requireCash(
        settings.mode === "AUTOMATIC" &&
          product.auto_update === true &&
          (settings.auto_update === true ||
            (!product.settings &&
              !product.cash_settings &&
              product.setting_auto_update === true)),
        "HB_CASH_POLICY_DENIED",
      );
    requireCash(
      Date.parse(saved.expiresAt) >= this.now(),
      "HB_CASH_PREVIEW_STALE",
    );
    requireCash(
      product.hb_cash_economics?.fingerprint === saved.fingerprint,
      "STALE_PREVIEW",
    );
  }
  async refresh(rows, queryable, providerReads = null) {
    const policy = this.policy();
    const summaries = [];
    for (const row of rows) {
      if (!this.scope(row, policy)) {
        if (row.hb_cash_economics?.applied)
          await queryable.query(
            "UPDATE products SET hb_cash_economics=NULL WHERE marketplace='HEPSIBURADA' AND barcode=$1",
            [row.barcode],
          );
        continue;
      }
      let snapshot;
      try {
        const read = providerReads?.get(
          JSON.stringify([row.merchant_sku, row.hb_sku]),
        );
        if (providerReads) {
          requireCash(read, "HB_CASH_PREFETCH_MISSING");
          if (read.error) throw read.error;
        }
        snapshot = await this.observe(row, { queryable, ...read });
      } catch (error) {
        snapshot = {
          version: VERSION,
          mode: policy.mode,
          revision: policy.revision,
          pricingAuthorized: false,
          legacy: this.legacy(row),
          blockers: [error.code || "HB_CASH_EVIDENCE_UNAVAILABLE"],
        };
      }
      requireCash(
        this.policy().revision === policy.revision,
        "HB_CASH_POLICY_CHANGED",
      );
      const cache = {
        ...snapshot,
        barcode: row.barcode,
        applied: policy.mode === "ENFORCE" && !snapshot.blockers,
      };
      delete cache.batch;
      try {
        await queryable.query(
          `UPDATE products SET hb_cash_economics=$2::jsonb,
          min_price=CASE WHEN $6 THEN NULL WHEN $3 THEN $4 ELSE min_price END,
          calculated_min_price=CASE WHEN $6 THEN NULL WHEN $3 THEN $4 ELSE calculated_min_price END,
          calculated_net_profit=CASE WHEN $6 THEN NULL WHEN $3 THEN $5 ELSE calculated_net_profit END,
          calculated_net_margin=CASE WHEN $6 THEN NULL WHEN $3 AND my_price>0 THEN ROUND($5::numeric/my_price*100,2) ELSE calculated_net_margin END,
          data_complete=CASE WHEN $6 THEN FALSE ELSE data_complete END,
          data_status=CASE WHEN $6 THEN 'HB_CASH_EVIDENCE_UNVERIFIED' ELSE data_status END
          WHERE marketplace='HEPSIBURADA' AND barcode=$1`,
          [
            row.barcode,
            JSON.stringify(cache),
            cache.applied,
            snapshot.minimum ?? null,
            snapshot.contribution ?? null,
            policy.mode === "ENFORCE" && Boolean(snapshot.blockers),
          ],
        );
      } catch (error) {
        if (error.code === "42703")
          throw new AppError(
            "HB cash schema review/migration required",
            409,
            "HB_CASH_SCHEMA_REQUIRED",
          );
        throw error;
      }
      summaries.push(cache);
    }
    return summaries;
  }
}
module.exports = { HepsiburadaCashEconomyService, VERSION };
