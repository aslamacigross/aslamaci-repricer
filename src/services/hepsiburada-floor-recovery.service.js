const crypto = require("crypto");
const { env } = require("../config/env");
const {
  matchesOwnListing,
} = require("../domain/hepsiburada-merchant-identity");
const { proposePrice, safetyCheck } = require("../domain/repricer");
const {
  calculateNetProfit,
  calculateNetMargin,
  selectShippingCost,
} = require("../domain/pricing");
const {
  requireFloor,
  finite,
  solveHepsiburadaFloor,
} = require("../domain/hepsiburada-floor");
const { priceTierForQuantity } = require("../domain/supplier-products");
const {
  roundMoney,
  parseBoolean,
  decimalToInteger,
  integerToDecimal,
  divideRounded,
} = require("../utils/numbers");

const VERSION = "HB_SAFE_FLOOR_V1";
const SOURCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
function fresh(value, now, age = SOURCE_MAX_AGE_MS) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) && now - time >= 0 && now - time <= age;
}
function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key] ?? null]));
}
function policySnapshot(settings, product, global) {
  const result = {
    strategy: settings.strategy || "Manuel",
    mode: settings.mode,
    auto_update: parseBoolean(settings.auto_update),
    unlimited_increase: parseBoolean(settings.unlimited_increase),
    blacklisted: parseBoolean(settings.blacklisted),
  };
  const defaults = {
    minimum_profit_tl: product.target_profit ?? global.defaultTargetProfit ?? 0,
    minimum_profit_pct: 0,
    minimum_margin_pct: 0,
    minimum_price: 0,
    maximum_price: 0,
    max_increase_tl: global.defaultMaxIncrease ?? env.defaultMaxIncrease,
    max_single_change_pct: global.maxChangePct ?? 0,
    price_cut_tl: global.defaultPriceCut ?? 0.1,
    daily_action_limit: 3,
    min_change_interval_minutes: 30,
    min_undercut_tl: 0.1,
    max_undercut_tl: 75,
  };
  for (const [key, fallback] of Object.entries(defaults))
    result[key] = Number(settings[key] ?? fallback);
  return result;
}
function listingNumber(row, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((o, p) => o?.[p], row);
    if (finite(value)) return Number(value);
  }
  return NaN;
}

class HepsiburadaFloorRecoveryService {
  constructor({
    db,
    hepsiburada,
    enabled = env.hepsiburadaFloorRecoveryEnabled,
    now = () => Date.now(),
  }) {
    Object.assign(this, { db, hepsiburada, enabled, now });
    this.rateLimitedUntil = 0;
  }
  eligible(product, settings) {
    return (
      this.enabled === true &&
      product.marketplace === "HEPSIBURADA" &&
      (product.rank == null ||
        (Number.isInteger(Number(product.rank)) && Number(product.rank) > 0)) &&
      settings.mode === "AUTOMATIC" &&
      parseBoolean(product.auto_update) &&
      parseBoolean(settings.auto_update) &&
      Number(product.my_price) > 0 &&
      Number(product.my_price) < Number(product.min_price)
    );
  }

  // Bounded, batched SELECTs. No source selection, sync, recalculation or writes.
  async loadBatch(products, queryable = this.db, excludeActionId = null) {
    requireFloor(
      products.length > 0 && products.length <= 200,
      "HB_FLOOR_BATCH_LIMIT",
    );
    const codes = products.map((p) => p.barcode);
    const policies = (
      await queryable.query(`SELECT key,value FROM system_settings
      WHERE key IN('default_carrier_hepsiburada','default_carrier','service_fee_hepsiburada','service_fee') ORDER BY key`)
    ).rows;
    const policy = Object.fromEntries(policies.map((r) => [r.key, r.value]));
    const carrier =
      policy.default_carrier_hepsiburada ||
      policy.default_carrier ||
      env.defaultCarrier;
    const minimumServiceFee = Number(
      policy.service_fee_hepsiburada ??
        policy.service_fee ??
        env.defaultServiceFee,
    );
    requireFloor(
      Number.isFinite(minimumServiceFee) && minimumServiceFee >= 0,
      "HB_FLOOR_EXPENSE_UNVERIFIED",
    );
    const mappings = (
      await queryable.query(
        `SELECT pcm.*,ci.id AS cost_item_id,ci.unit_cost AS canonical_unit_cost,
      ci.unit_desi,ci.lifecycle_status,ci.price_source,ci.source_checked_at,
      COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM cost_item_supplier_offers s
        JOIN file_market_items f ON f.id=s.supplier_offer_id
        WHERE s.cost_item_id=ci.id AND s.status='APPROVED' AND s.is_selected=TRUE),'[]'::jsonb) selected_offers,
      COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM cost_item_file_links l
        JOIN file_market_items f ON f.id=l.file_market_item_id
        WHERE l.cost_item_code=ci.item_code AND l.status='APPROVED'),'[]'::jsonb) legacy_offers
      FROM product_cost_mappings pcm LEFT JOIN cost_items ci ON ci.item_code=pcm.cost_item_code
      WHERE pcm.marketplace='HEPSIBURADA' AND pcm.barcode=ANY($1::text[]) ORDER BY pcm.id LIMIT 2001`,
        [codes],
      )
    ).rows;
    requireFloor(mappings.length <= 2000, "HB_FLOOR_BATCH_LIMIT");
    const rates = (
      await queryable.query(
        `SELECT * FROM shipping_costs WHERE marketplace='HEPSIBURADA'
      AND carrier=$1 AND desi_kg=ANY($2::numeric[]) ORDER BY desi_kg`,
        [carrier, products.map((p) => p.desi)],
      )
    ).rows;
    const barems = (
      await queryable.query(
        `SELECT * FROM shipping_barems WHERE marketplace='HEPSIBURADA'
      AND carrier=$1 ORDER BY min_basket LIMIT 201`,
        [carrier],
      )
    ).rows;
    requireFloor(barems.length <= 200, "HB_FLOOR_BATCH_LIMIT");
    const expenses = (
      await queryable.query(
        `SELECT p.barcode,cr.commission_rate AS configured_commission,
      pr.id AS rule_id,pr.packaging_cost AS configured_packaging
      FROM products p LEFT JOIN commission_rules cr ON cr.marketplace=p.marketplace AND cr.category_id=p.category_id
      LEFT JOIN LATERAL (SELECT x.* FROM packaging_rules x WHERE
        (x.marketplace=p.marketplace OR x.marketplace='TRENDYOL') AND COALESCE(x.active,TRUE)=TRUE AND (
        (x.rule_scope='BARCODE' AND UPPER(x.match_value)=UPPER(p.barcode)) OR
        (x.rule_scope='PRODUCT_NAME' AND p.product_name ILIKE '%'||x.match_value||'%') OR
        (x.rule_scope='CATEGORY' AND p.category_name ILIKE '%'||x.match_value||'%') OR
        (x.rule_scope='BRAND' AND p.brand ILIKE '%'||x.match_value||'%') OR
        (x.rule_scope='DESI' AND p.desi BETWEEN x.min_desi AND x.max_desi))
        ORDER BY CASE x.rule_scope WHEN 'BARCODE' THEN 5 WHEN 'PRODUCT_NAME' THEN 4 WHEN 'CATEGORY' THEN 3
          WHEN 'BRAND' THEN 2 ELSE 1 END DESC,x.priority DESC,
          CASE WHEN x.marketplace=p.marketplace THEN 1 ELSE 0 END DESC,x.id DESC LIMIT 1) pr ON TRUE
      WHERE p.marketplace='HEPSIBURADA' AND p.barcode=ANY($1::text[])`,
        [codes],
      )
    ).rows;
    const open = (
      await queryable.query(
        `SELECT id,barcode FROM repricer_actions
      WHERE marketplace='HEPSIBURADA' AND barcode=ANY($1::text[]) AND ($2::bigint IS NULL OR id<>$2)
      AND status IN('PENDING','APPROVED','SENDING','AWAITING_RESULT')
      AND NOT(status IN('PENDING','APPROVED') AND expires_at IS NOT NULL AND expires_at<NOW())`,
        [codes, excludeActionId],
      )
    ).rows;
    return {
      carrier,
      minimumServiceFee,
      mappings,
      rates,
      barems,
      expenses,
      open,
    };
  }

  verifyCost(product, batch) {
    const rows = batch.mappings.filter((r) => r.barcode === product.barcode);
    requireFloor(
      rows.length > 0 && rows.length <= 100,
      "HB_FLOOR_RECIPE_UNVERIFIED",
    );
    requireFloor(
      new Set(rows.map((r) => r.cost_item_code)).size === rows.length,
      "HB_FLOOR_RECIPE_UNVERIFIED",
    );
    let costUnits = 0n,
      desiUnits = 0n;
    for (const row of rows) {
      const qty = Number(row.quantity);
      requireFloor(
        row.cost_item_id &&
          row.lifecycle_status === "ACTIVE" &&
          Number.isInteger(qty) &&
          qty >= 1 &&
          Number(row.canonical_unit_cost) > 0 &&
          Number(row.unit_desi) > 0,
        "HB_FLOOR_RECIPE_UNVERIFIED",
      );
      const offers = row.selected_offers.length
        ? row.selected_offers
        : row.legacy_offers;
      requireFloor(offers.length === 1, "HB_FLOOR_SOURCE_AMBIGUOUS");
      const offer = offers[0];
      requireFloor(
        (offer.offer_type || "LIVE") === "LIVE" &&
          offer.supplier_code !== "OTHER" &&
          row.price_source === offer.supplier_code &&
          offer.availability === "AVAILABLE" &&
          Number(offer.current_price) > 0,
        "HB_FLOOR_SOURCE_UNVERIFIED",
      );
      const raw = offer.raw_data || {};
      const explicitCheck = fresh(offer.checked_at, this.now());
      const verifiedBizim =
        offer.supplier_code === "BIZIM_MARKET" &&
        raw.price_tiers_verified === true &&
        raw.price_tiers_source === "BIZIM_PRODUCT_DETAIL" &&
        fresh(raw.price_tiers_verified_at, this.now());
      const verifiedFile =
        offer.supplier_code === "FILE_MARKET" &&
        raw.provider === "file-market-api" &&
        Number(raw.product_price) === Number(offer.current_price) &&
        fresh(row.source_checked_at, this.now());
      requireFloor(
        explicitCheck || verifiedBizim || verifiedFile,
        "HB_FLOOR_SOURCE_STALE",
      );
      requireFloor(
        Number(row.canonical_unit_cost) === Number(offer.current_price),
        "HB_FLOOR_SOURCE_PRICE_MISMATCH",
      );
      const tier = verifiedBizim
        ? priceTierForQuantity(
            offer.current_price,
            offer.price_tiers || [],
            qty,
          )
        : { unitPrice: Number(offer.current_price) };
      const unit = Number(row.effective_unit_cost ?? row.canonical_unit_cost);
      requireFloor(unit === tier.unitPrice, "HB_FLOOR_TIER_MISMATCH");
      costUnits += BigInt(qty) * decimalToInteger(unit, 4);
      desiUnits += BigInt(qty) * decimalToInteger(row.unit_desi, 4);
    }
    const effectiveDesi =
      product.manual_desi_override == null
        ? Number((desiUnits + 9999n) / 10000n)
        : Number(product.manual_desi_override);
    requireFloor(
      Number.isInteger(effectiveDesi) &&
        effectiveDesi > 0 &&
        effectiveDesi === Number(product.desi),
      "HB_FLOOR_DESI_UNVERIFIED",
    );
    requireFloor(
      integerToDecimal(divideRounded(costUnits, 100n), 2) ===
        Number(product.calculated_product_cost),
      "HB_FLOOR_COST_CHANGED",
    );
    const expense = batch.expenses.find((e) => e.barcode === product.barcode);
    requireFloor(
      expense &&
        Number(expense.configured_commission) ===
          Number(product.commission_rate) &&
        Number(expense.configured_commission) > 0 &&
        Number(expense.configured_commission) < 100,
      "HB_FLOOR_COMMISSION_UNVERIFIED",
    );
    requireFloor(
      expense.rule_id &&
        String(expense.rule_id) === String(product.packaging_rule_id) &&
        Number(expense.configured_packaging) ===
          Number(product.packaging_cost) &&
        finite(product.service_fee) &&
        Number(product.service_fee) >=
          Number(batch.minimumServiceFee ?? env.defaultServiceFee),
      "HB_FLOOR_EXPENSE_UNVERIFIED",
    );
    requireFloor(
      !batch.open.some((a) => a.barcode === product.barcode),
      "OPEN_ACTION_EXISTS",
    );
    const shipping = selectShippingCost({
      salePrice: product.my_price,
      desi: effectiveDesi,
      carrier: batch.carrier,
      barems: batch.barems,
      costs: batch.rates,
    });
    requireFloor(
      shipping > 0 && shipping === Number(product.calculated_shipping_cost),
      "HB_FLOOR_SHIPPING_CHANGED",
    );
    return {
      rows,
      cost: integerToDecimal(divideRounded(costUnits, 100n), 2),
      desi: effectiveDesi,
      expense,
    };
  }

  async evaluate({
    product,
    settings,
    global,
    proposal,
    today,
    batch,
    action = null,
    queryable = this.db,
  }) {
    const baseline = safetyCheck({
      product,
      settings,
      global,
      proposal,
      today,
    });
    if (!this.eligible(product, settings)) return null;
    const blocked = (code) => ({
      proposal,
      safety: {
        ...baseline,
        safe: false,
        failures: [...new Set([...baseline.failures, code])],
      },
    });
    try {
      requireFloor(
        !action ||
          (action.action === "MIN_FIYATA_TOPARLA" &&
            ["AUTO", "JOB", "WEB"].includes(action.source) &&
            !action.reverts_action_id &&
            action.safety_checks?.hbFloorRecovery?.version === VERSION),
        "HB_FLOOR_ACTION_UNVERIFIED",
      );
      const buyboxException = product.rank == null;
      requireFloor(
        Number(product.buybox_price) > 0 &&
          (buyboxException
            ? baseline.failures.length === 1 &&
              baseline.failures[0] === "BUYBOX_MISSING"
            : baseline.safe),
        "HB_FLOOR_OTHER_BLOCKER",
      );
      batch = batch || (await this.loadBatch([product], queryable, action?.id));
      const verified = this.verifyCost(product, batch);
      const target = solveHepsiburadaFloor({
        money: {
          productCost: verified.cost,
          packagingCost: product.packaging_cost,
          serviceFee: product.service_fee,
          commissionRate: product.commission_rate,
          targetProfit: Math.max(
            Number(product.target_profit) || 0,
            Number(settings.minimum_profit_tl) || 0,
          ),
        },
        minimum: Math.max(
          Number(product.min_price),
          Number(settings.minimum_price) || 0,
        ),
        current: Number(product.my_price),
        desi: verified.desi,
        carrier: batch.carrier,
        barems: batch.barems,
        rates: batch.rates,
      });
      const adjusted = {
        ...product,
        min_price: target.price,
        calculated_shipping_cost: target.shippingCost,
      };
      const next = proposePrice(adjusted, settings);
      requireFloor(
        next.action === "MIN_FIYATA_TOPARLA" &&
          next.proposedPrice >= target.price,
        "HB_FLOOR_TARGET_BLOCKED",
      );
      const money = {
        salePrice: next.proposedPrice,
        productCost: verified.cost,
        shippingCost: target.shippingCost,
        packagingCost: product.packaging_cost,
        serviceFee: product.service_fee,
        commissionRate: product.commission_rate,
      };
      next.expectedProfit = calculateNetProfit(money);
      next.expectedMargin = calculateNetMargin(money);
      const safety = safetyCheck({
        product: adjusted,
        settings,
        global,
        proposal: next,
        today,
      });
      requireFloor(
        buyboxException
          ? safety.failures.length === 1 &&
              safety.failures[0] === "BUYBOX_MISSING"
          : safety.safe,
        "HB_FLOOR_OTHER_BLOCKER",
      );
      const fingerprint = crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            product: pick(product, [
              "marketplace",
              "barcode",
              "merchant_sku",
              "hb_sku",
              "marketplace_product_id",
              "my_price",
              "min_price",
              "calculated_product_cost",
              "calculated_shipping_cost",
              "commission_rate",
              "service_fee",
              "packaging_cost",
              "desi",
              "manual_desi_override",
              "auto_update",
              "target_profit",
              "is_active",
              "stock_quantity",
              "on_sale",
              "locked",
              "rank",
            ]),
            settings: policySnapshot(settings, product, global),
            global,
            rows: verified.rows,
            carrier: batch.carrier,
            minimumServiceFee: batch.minimumServiceFee ?? env.defaultServiceFee,
            barems: batch.barems,
            rates: batch.rates.filter(
              (rate) => Number(rate.desi_kg) === verified.desi,
            ),
            expense: verified.expense,
          }),
        )
        .digest("hex");
      if (action)
        requireFloor(
          action.safety_checks.hbFloorRecovery.fingerprint === fingerprint &&
            Number(action.proposed_price) === next.proposedPrice &&
            Number(action.old_price) === Number(product.my_price),
          "STALE_PREVIEW",
        );
      requireFloor(this.now() >= this.rateLimitedUntil, "HB_FLOOR_RATE_LIMIT");
      const listing = await this.hepsiburada.readListingForPrice({
        merchantSku: product.merchant_sku || product.barcode,
        hbSku: product.hb_sku || product.marketplace_product_id,
      });
      requireFloor(
        matchesOwnListing(product, listing),
        "HB_FLOOR_MARKET_IDENTITY_UNVERIFIED",
      );
      const price = listingNumber(listing, [
        "price.amount",
        "price.value",
        "price",
        "salePrice",
        "unitPrice",
        "merchantUnitPrice",
        "listingPrice",
      ]);
      requireFloor(
        price > 0 && roundMoney(price) === roundMoney(product.my_price),
        "MARKET_PRICE_MISMATCH",
      );
      requireFloor(
        listing.isSalable === true &&
          listingNumber(listing, [
            "availableStock",
            "stock",
            "quantity",
            "availableQuantity",
            "inventory",
          ]) > 0,
        "MARKET_PRODUCT_UNAVAILABLE",
      );
      requireFloor(
        next.proposedPrice > price && price < target.price,
        "HB_FLOOR_NOT_UPWARD",
      );
      return {
        proposal: next,
        safety: {
          ...safety,
          safe: true,
          failures: [],
          hbFloorRecovery: {
            version: VERSION,
            buyboxException,
            fingerprint,
            minimum: target.price,
            shippingCost: target.shippingCost,
            checkedAt: new Date(this.now()).toISOString(),
          },
        },
      };
    } catch (error) {
      if (Number(error.status) === 429 || error.code === "HTTP_429") {
        this.rateLimitedUntil =
          this.now() + Math.max(Number(error.retryAfterMs) || 600000, 60000);
        return blocked("HB_FLOOR_RATE_LIMIT");
      }
      return blocked(error.code || "HB_FLOOR_EVIDENCE_UNAVAILABLE");
    }
  }
}
module.exports = {
  HepsiburadaFloorRecoveryService,
  VERSION,
  SOURCE_MAX_AGE_MS,
};
