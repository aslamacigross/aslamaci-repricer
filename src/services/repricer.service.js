const crypto = require("crypto");
const { proposePrice, safetyCheck } = require("../domain/repricer");
const { calculateNetProfit, calculateNetMargin } = require("../domain/pricing");
const { roundMoney, parseBoolean } = require("../utils/numbers");
const { env } = require("../config/env");
const { AppError } = require("../utils/errors");

class RepricerService {
  constructor({ db, actions, settings }) {
    this.db = db;
    this.actions = actions;
    this.settings = settings;
  }

  async globalSettings() {
    const stored = await this.settings.getAll();
    return {
      dryRun: stored.global_dry_run ?? env.dryRun,
      repricerEnabled: stored.global_repricer_enabled ?? env.repricerEnabled,
      maxChangePct:
        stored.global_max_price_change_pct ?? env.globalMaxPriceChangePct,
      maxDailyDecreasePct:
        stored.global_max_daily_decrease_pct ??
        env.globalMaxDailyDecreasePct ??
        5,
      unlimitedIncrease: stored.global_unlimited_increase ?? true,
      minChangeTl: env.minPriceChangeTl,
      buyboxMaxAgeMinutes:
        stored.buybox_max_age_minutes ?? env.buyboxMaxAgeMinutes,
      defaultMaxIncrease:
        stored.default_max_increase_tl ?? env.defaultMaxIncrease,
      defaultPriceCut: stored.default_price_cut_tl ?? 0.1,
      defaultTargetProfit:
        stored.default_target_profit ?? env.defaultTargetProfit,
    };
  }

  ensureSupportedMarketplace(marketplace) {
    const normalized = String(marketplace || "TRENDYOL").toUpperCase();
    if (normalized !== "TRENDYOL")
      throw new AppError(
        "Hepsiburada repricer bağlantısı credentials bekliyor",
        409,
        "MARKETPLACE_CREDENTIALS_MISSING",
      );
    return normalized;
  }

  async candidates(barcode, marketplace = "TRENDYOL") {
    const normalizedMarketplace = this.ensureSupportedMarketplace(marketplace);
    const params = [normalizedMarketplace];
    let filter = "AND COALESCE(ps.auto_update,p.auto_update,FALSE)=TRUE";
    if (Array.isArray(barcode) && barcode.length) {
      params.push(barcode);
      filter = "AND p.barcode=ANY($2::text[])";
    } else if (barcode) {
      params.push(barcode);
      filter = "AND p.barcode=$2";
    }
    return (
      await this.db.query(
        `SELECT p.*,
      CASE WHEN COALESCE(rl.paused,FALSE) THEN 'Kâr Koru' ELSE COALESCE(ps.strategy,'Manuel') END strategy,
      ps.price_cut_tl,ps.max_increase_tl,ps.max_single_change_pct,ps.max_daily_change_pct,
      ps.minimum_profit_tl,
      COALESCE(ps.minimum_profit_pct,0)minimum_profit_pct,
      COALESCE(ps.minimum_margin_pct,0)minimum_margin_pct,ps.minimum_price,ps.maximum_price,
      COALESCE(ps.min_undercut_tl,0.1)min_undercut_tl,COALESCE(ps.max_undercut_tl,75)max_undercut_tl,
      COALESCE(ps.min_change_interval_minutes,30)min_change_interval_minutes,COALESCE(ps.daily_action_limit,3)daily_action_limit,
      COALESCE(ps.buybox_max_age_minutes,20)buybox_max_age_minutes,COALESCE(ps.blacklisted,FALSE)blacklisted,
      COALESCE(ps.auto_update,p.auto_update,FALSE)setting_auto_update,COALESCE(ps.mode,'MANUAL')mode,
      COALESCE(ps.unlimited_increase,TRUE) unlimited_increase,
      COALESCE(rl.learned_price_cut_tl,0)learned_price_cut_tl,
      rl.learned_max_increase_tl,COALESCE(rl.confidence_score,0)confidence_score,
      COALESCE(rl.paused,FALSE)learning_paused
      FROM products p LEFT JOIN product_settings ps ON ps.marketplace=p.marketplace AND ps.barcode=p.barcode
      LEFT JOIN repricer_learning rl ON rl.marketplace=p.marketplace AND rl.barcode=p.barcode
      WHERE p.marketplace=$1 ${filter} ORDER BY p.product_name`,
        params,
      )
    ).rows;
  }

  async preview(barcode, marketplace = "TRENDYOL") {
    if (Array.isArray(barcode) && barcode.length === 0) return [];
    const normalizedMarketplace = this.ensureSupportedMarketplace(marketplace);
    const global = await this.globalSettings();
    const products = await this.candidates(barcode, normalizedMarketplace);
    const results = [];
    for (const product of products) {
      const settings = {
        ...product,
        price_cut_tl: product.price_cut_tl ?? global.defaultPriceCut,
        max_increase_tl: product.max_increase_tl ?? global.defaultMaxIncrease,
        max_single_change_pct:
          product.max_single_change_pct ?? global.maxChangePct,
        max_daily_change_pct:
          product.max_daily_change_pct ?? global.maxChangePct,
        minimum_profit_tl:
          product.minimum_profit_tl ??
          product.target_profit ??
          global.defaultTargetProfit,
        auto_update: product.setting_auto_update,
        // The global unlimited switch is a safety-wide override. A legacy
        // product-level cap must not silently turn an unlimited pilot into KORU.
        unlimited_increase:
          parseBoolean(global.unlimitedIncrease) ||
          parseBoolean(product.unlimited_increase),
      };
      const proposal = proposePrice(product, settings);
      const today = await this.actions.todayStats(
        product.barcode,
        normalizedMarketplace,
      );
      const safety = safetyCheck({
        product,
        settings,
        global,
        proposal,
        today: {
          actionCount: today.action_count,
          dayStartPrice: today.day_start_price,
        },
      });
      results.push({
        ...proposal,
        safetyChecks: safety,
        blockedReasons: safety.failures,
        barcode: product.barcode,
        productName: product.product_name,
        netProfitBefore: Number(product.calculated_net_profit || 0),
      });
    }
    return results;
  }

  async generate({ barcode, source = "WEB", marketplace = "TRENDYOL" } = {}) {
    const normalizedMarketplace = this.ensureSupportedMarketplace(marketplace);
    const previews = await this.preview(barcode, normalizedMarketplace);
    const created = [];
    const errors = [];
    const skipped = [];
    for (const preview of previews) {
      if (preview.action === "KORU") continue;
      try {
        const automatic = source === "AUTO" || source === "JOB";
        const blockingSafetyFailures = (preview.blockedReasons || []).filter(
          (code) => !["DRY_RUN", "GLOBAL_REPRICER_DISABLED"].includes(code),
        );
        if (automatic && blockingSafetyFailures.length) {
          skipped.push({
            barcode: preview.barcode,
            reason: "SAFETY_BLOCKED",
            blockedReasons: blockingSafetyFailures,
          });
          continue;
        }
        if (preview.action === "FIYAT_ARTIR" && preview.rank === 1) {
          const probe = await this.actions.findPendingIncreaseProbe(
            preview.barcode,
            normalizedMarketplace,
          );
          if (probe) {
            skipped.push({
              barcode: preview.barcode,
              reason: "BUYBOX_INCREASE_OUTCOME_PENDING",
              actionId: probe.id,
              status: probe.status,
            });
            continue;
          }
        }
        const open = await this.actions.findOpen(
          preview.barcode,
          this.db,
          null,
          normalizedMarketplace,
        );
        if (open) {
          skipped.push({
            barcode: preview.barcode,
            reason: "OPEN_ACTION_EXISTS",
            actionId: open.id,
            status: open.status,
          });
          continue;
        }
        const validityBucket = Math.floor(
          new Date(preview.expiresAt).getTime() / (15 * 60 * 1000),
        );
        const key = crypto
          .createHash("sha256")
          .update(
            `${normalizedMarketplace}:${preview.barcode}:${preview.oldPrice}:${preview.proposedPrice}:${preview.buyboxPrice}:${validityBucket}`,
          )
          .digest("hex");
        const action = await this.actions.create({
          marketplace: normalizedMarketplace,
          barcode: preview.barcode,
          product_name: preview.productName,
          old_price: preview.oldPrice,
          proposed_price: preview.proposedPrice,
          action: preview.action,
          strategy: preview.strategy,
          reason: preview.reason,
          status: "PENDING",
          source,
          idempotency_key: key,
          min_price: preview.minPrice,
          buybox_before: preview.buyboxPrice,
          rank_before: preview.rank,
          target_rank: preview.targetRank,
          second_price: preview.secondPrice,
          third_price: preview.thirdPrice,
          expected_profit: preview.expectedProfit,
          expected_margin: preview.expectedMargin,
          net_profit_before: preview.netProfitBefore,
          safety_checks: preview.safetyChecks,
          expires_at: preview.expiresAt,
        });
        await this.actions.recordDecision(
          action.id,
          { barcode: preview.barcode, strategy: preview.strategy },
          preview,
        );
        created.push(action);
      } catch (error) {
        errors.push({
          barcode: preview.barcode,
          code: error.code || "ACTION_CREATE_FAILED",
          message: error.message,
        });
      }
    }
    return {
      processed: previews.length,
      created: created.length,
      items: created,
      failed: errors.length,
      skipped: skipped.length,
      skippedItems: skipped,
      errors,
    };
  }

  async manualAction(barcode, proposedPrice, actor, options = {}) {
    const normalizedMarketplace = this.ensureSupportedMarketplace(
      options.marketplace,
    );
    const products = await this.candidates(barcode, normalizedMarketplace);
    const product = products[0];
    if (!product)
      throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
    const price = roundMoney(proposedPrice);
    const current = roundMoney(product.my_price);
    const action =
      price < current
        ? "FIYAT_DUSUR"
        : price > current
          ? current < Number(product.min_price)
            ? "MIN_FIYATA_TOPARLA"
            : "FIYAT_ARTIR"
          : "KORU";
    const moneyInput = {
      salePrice: price,
      commissionRate: product.commission_rate,
      productCost: product.calculated_product_cost,
      shippingCost: product.calculated_shipping_cost,
      packagingCost: product.packaging_cost,
      serviceFee: product.service_fee,
    };
    const proposal = {
      action,
      proposedPrice: price,
      expectedProfit: calculateNetProfit(moneyInput),
      expectedMargin: calculateNetMargin(moneyInput),
    };
    const global = await this.globalSettings();
    const today = await this.actions.todayStats(barcode, normalizedMarketplace);
    const settings = {
      ...product,
      price_cut_tl: product.price_cut_tl ?? global.defaultPriceCut,
      max_increase_tl: product.max_increase_tl ?? global.defaultMaxIncrease,
      max_single_change_pct:
        product.max_single_change_pct ?? global.maxChangePct,
      max_daily_change_pct: product.max_daily_change_pct ?? global.maxChangePct,
      minimum_profit_tl:
        product.minimum_profit_tl ??
        product.target_profit ??
        global.defaultTargetProfit,
      auto_update: product.setting_auto_update,
      unlimited_increase:
        parseBoolean(global.unlimitedIncrease) ||
        parseBoolean(product.unlimited_increase),
    };
    const safety = safetyCheck({
      product,
      settings,
      global,
      proposal,
      manual: true,
      today: {
        actionCount: today.action_count,
        dayStartPrice: today.day_start_price,
      },
    });
    const hardFailures = safety.failures.filter((code) => code !== "DRY_RUN");
    if (hardFailures.length)
      throw new AppError(
        `Manuel fiyat aksiyonu güvenlik kontrollerinden geçmedi: ${hardFailures.join(", ")}`,
        409,
        "SAFETY_BLOCKED",
        hardFailures,
      );
    const key =
      options.idempotencyKey ||
      crypto
        .createHash("sha256")
        .update(
          `manual:${normalizedMarketplace}:${barcode}:${current}:${price}:${product.updated_at}`,
        )
        .digest("hex");
    const source = options.source || "MANUAL";
    const strategy = options.strategy || "Manuel";
    const created = await this.actions.create({
      marketplace: normalizedMarketplace,
      barcode,
      product_name: product.product_name,
      old_price: current,
      proposed_price: price,
      action,
      strategy,
      reason: options.reason || `${actor} tarafından manuel fiyat aksiyonu`,
      status: "PENDING",
      source,
      idempotency_key: key,
      min_price: product.min_price,
      buybox_before: product.buybox_price,
      rank_before: product.rank,
      target_rank: product.rank,
      second_price: product.second_price,
      third_price: product.third_price,
      expected_profit: proposal.expectedProfit,
      expected_margin: proposal.expectedMargin,
      net_profit_before: product.calculated_net_profit,
      safety_checks: safety,
      expires_at: new Date(Date.now() + 15 * 60000),
      reverts_action_id: options.revertsActionId || null,
    });
    await this.actions.recordDecision(
      created.id,
      { barcode, strategy, actor, source },
      { ...proposal, safety },
    );
    return created;
  }
}

module.exports = { RepricerService };
