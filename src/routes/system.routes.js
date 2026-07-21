const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");
function systemRoutes({
  products,
  jobs,
  jobService,
  settings,
  audit,
  sync,
  costEngine,
  repricer,
  health,
  hepsiburada,
  marketplaceRegistry,
}) {
  const r = express.Router();
  const productFilters = (query = {}) => ({
    ...query,
    active: query.active == null ? undefined : query.active === "true",
    stocked: query.stocked == null ? undefined : query.stocked === "true",
    autoUpdate:
      query.autoUpdate == null ? undefined : query.autoUpdate === "true",
  });
  r.get(
    "/buybox",
    asyncRoute(async (req, res) => {
      const marketplace = String(
        req.query.marketplace || "TRENDYOL",
      ).toUpperCase();
      const result = await products.list({
        ...productFilters(req.query),
        marketplace,
        status: req.query.status || undefined,
        limit: req.query.limit || 100,
        sort: "rank",
      });
      const previews =
        marketplace === "TRENDYOL"
          ? await repricer.preview(
              result.items.map((item) => item.barcode),
              marketplace,
            )
          : [];
      const previewByBarcode = new Map(
        previews.map((preview) => [preview.barcode, preview]),
      );
      res.json({
        status: "ok",
        ...result,
        items: result.items.map((item) => {
          const preview = previewByBarcode.get(item.barcode);
          return {
            ...item,
            preview_action: preview?.action || "KORU",
            preview_proposed_price: preview?.proposedPrice ?? item.my_price,
            preview_difference: preview?.difference ?? 0,
            preview_expected_profit: preview?.expectedProfit ?? null,
            preview_reason:
              preview?.reason ||
              (marketplace === "HEPSIBURADA"
                ? "Hepsiburada repricer bağlantısı credentials bekliyor"
                : "Fiyat korunuyor"),
            preview_blocked_reasons:
              preview?.blockedReasons ||
              (marketplace === "HEPSIBURADA"
                ? ["MARKETPLACE_CREDENTIALS_MISSING"]
                : []),
            preview_target_rank: preview?.targetRank ?? item.rank ?? null,
            preview_effective_undercut: preview?.effectiveUndercut ?? null,
          };
        }),
      });
    }),
  );
  r.post(
    "/sync/buybox",
    asyncRoute(async (req, res) => {
      const marketplace = String(
        req.body.marketplace || "TRENDYOL",
      ).toUpperCase();
      if (marketplace !== "TRENDYOL")
        throw new AppError(
          "Hepsiburada buybox bağlantısı credentials bekliyor",
          409,
          "MARKETPLACE_CREDENTIALS_MISSING",
        );
      res.json({
        status: "ok",
        data: await jobService.run("sync-buybox", { source: "web" }),
      });
    }),
  );
  r.get(
    "/jobs",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: await jobs.list() }),
    ),
  );
  r.get(
    "/jobs/runs",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: await jobs.runs(req.query.limit) }),
    ),
  );
  r.patch(
    "/jobs/:name",
    asyncRoute(async (req, res) => {
      if (
        req.body.schedule_minutes !== undefined &&
        (!Number.isFinite(Number(req.body.schedule_minutes)) ||
          Number(req.body.schedule_minutes) < 1)
      )
        throw new AppError(
          "Job sıklığı en az 1 dakika olmalı",
          400,
          "VALIDATION_ERROR",
        );
      const data = await jobs.update(req.params.name, {
        schedule_minutes:
          req.body.schedule_minutes === undefined
            ? null
            : Number(req.body.schedule_minutes),
        enabled:
          req.body.enabled === undefined ? null : Boolean(req.body.enabled),
      });
      if (!data) throw new AppError("Job bulunamadı", 404, "JOB_NOT_FOUND");
      await audit.record({
        actor: req.user.username,
        action: "JOB_SETTINGS_UPDATED",
        entityType: "job",
        entityId: req.params.name,
        after: data,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/jobs/:name/run",
    asyncRoute(async (req, res) => {
      const data = await jobService.run(req.params.name, {
        source: "web",
        actor: req.user.username,
      });
      await audit.record({
        actor: req.user.username,
        action: "JOB_MANUALLY_RUN",
        entityType: "job",
        entityId: req.params.name,
        after: data,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.get(
    "/settings",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: await settings.list() }),
    ),
  );
  r.patch(
    "/settings",
    asyncRoute(async (req, res) => {
      const input = { ...req.body };
      const confirmation = input.confirmation;
      delete input.confirmation;
      const current = await settings.getAll();
      const enablesLivePricing =
        (current.global_dry_run ?? true) !== false &&
        input.global_dry_run === false;
      const enablesAutomaticRepricer =
        (current.global_repricer_enabled ?? false) !== true &&
        input.global_repricer_enabled === true;
      if (
        (enablesLivePricing || enablesAutomaticRepricer) &&
        confirmation !== "CANLI_FIYAT_MODUNU_AC"
      )
        throw new AppError(
          "Canlı fiyat modu için açık güvenlik onayı gerekli",
          409,
          "LIVE_MODE_CONFIRMATION_REQUIRED",
        );
      const allowed = new Set([
        "global_dry_run",
        "global_repricer_enabled",
        "maintenance_mode",
        "default_target_profit",
        "default_price_cut_tl",
        "default_max_increase_tl",
        "global_max_price_change_pct",
        "global_max_daily_decrease_pct",
        "global_unlimited_increase",
        "default_carrier",
        "default_carrier_trendyol",
        "default_carrier_hepsiburada",
        "service_fee",
        "service_fee_trendyol",
        "service_fee_hepsiburada",
        "buybox_max_age_minutes",
        "product_sync_cron_minutes",
        "buybox_sync_cron_minutes",
        "cost_calculation_cron_minutes",
        "repricer_cron_minutes",
        "log_retention_days",
      ]);
      const numeric = new Set([
        "default_target_profit",
        "default_price_cut_tl",
        "default_max_increase_tl",
        "global_max_price_change_pct",
        "global_max_daily_decrease_pct",
        "service_fee",
        "service_fee_trendyol",
        "service_fee_hepsiburada",
        "buybox_max_age_minutes",
        "product_sync_cron_minutes",
        "buybox_sync_cron_minutes",
        "cost_calculation_cron_minutes",
        "repricer_cron_minutes",
        "log_retention_days",
      ]);
      const booleanSettings = new Set([
        "global_dry_run",
        "global_repricer_enabled",
        "maintenance_mode",
        "global_unlimited_increase",
      ]);
      const jobForSetting = {
        product_sync_cron_minutes: "sync-products",
        buybox_sync_cron_minutes: "sync-buybox",
        cost_calculation_cron_minutes: "calculate-costs",
        repricer_cron_minutes: "run-auto-repricer",
      };
      const positive = new Set([
        "buybox_max_age_minutes",
        "product_sync_cron_minutes",
        "buybox_sync_cron_minutes",
        "cost_calculation_cron_minutes",
        "repricer_cron_minutes",
        "log_retention_days",
      ]);
      const changed = [];
      const recalculateMarketplaces = new Set();
      for (const [key, value] of Object.entries(input)) {
        if (!allowed.has(key))
          throw new AppError(
            `Ayar değiştirilemez: ${key}`,
            400,
            "SETTING_NOT_ALLOWED",
          );
        if (booleanSettings.has(key) && typeof value !== "boolean")
          throw new AppError(
            `Geçersiz aç/kapat ayarı: ${key}`,
            400,
            "VALIDATION_ERROR",
          );
        if (key.startsWith("default_carrier") && !String(value || "").trim())
          throw new AppError(
            "Varsayılan kargo firması boş olamaz",
            400,
            "VALIDATION_ERROR",
          );
        if (
          numeric.has(key) &&
          (!Number.isFinite(Number(value)) ||
            Number(value) < 0 ||
            (positive.has(key) && Number(value) < 1))
        )
          throw new AppError(
            `Geçersiz sayısal ayar: ${key}`,
            400,
            "VALIDATION_ERROR",
          );
      }
      for (const [key, value] of Object.entries(input)) {
        changed.push(await settings.set(key, value, req.user.username));
        if (key === "service_fee" || key === "service_fee_trendyol") {
          await settings.applyServiceFeeToProducts(Number(value), "TRENDYOL");
          recalculateMarketplaces.add("TRENDYOL");
        }
        if (key === "service_fee_hepsiburada") {
          await settings.applyServiceFeeToProducts(
            Number(value),
            "HEPSIBURADA",
          );
          recalculateMarketplaces.add("HEPSIBURADA");
        }
        if (["default_carrier", "default_carrier_trendyol"].includes(key))
          recalculateMarketplaces.add("TRENDYOL");
        if (key === "default_carrier_hepsiburada")
          recalculateMarketplaces.add("HEPSIBURADA");
        if (jobForSetting[key])
          await jobs.update(jobForSetting[key], {
            schedule_minutes: Number(value),
            enabled: null,
          });
      }
      for (const selectedMarketplace of recalculateMarketplaces)
        await costEngine.recalculate(undefined, undefined, selectedMarketplace);
      await audit.record({
        actor: req.user.username,
        action: "SYSTEM_SETTINGS_UPDATED",
        entityType: "system_settings",
        after: input,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", items: changed });
    }),
  );
  r.get(
    "/health-report",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await health.latest(),
        items: await health.history(req.query.limit),
      }),
    ),
  );
  r.post(
    "/health-report/run",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await jobService.run("daily-system-health", {
          source: "web",
          actor: req.user.username,
        }),
      }),
    ),
  );
  r.get(
    "/integrations",
    asyncRoute(async (req, res) =>
      {
        const items = marketplaceRegistry
          ? await marketplaceRegistry.list()
          : [];
        const byCode = Object.fromEntries(
          items.map((item) => [item.code.toLowerCase(), item]),
        );
        res.json({
          status: "ok",
          items,
          data: items.length
            ? byCode
            : {
                trendyol: await sync.health(),
                hepsiburada: {
                  configured: hepsiburada?.configured?.() || false,
                },
              },
        });
      },
    ),
  );
  r.get(
    "/integrations/:marketplace",
    asyncRoute(async (req, res) => {
      const data = await marketplaceRegistry.get(req.params.marketplace);
      if (!data)
        throw new AppError(
          "Pazaryeri bulunamadı",
          404,
          "MARKETPLACE_NOT_FOUND",
        );
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/integrations/:marketplace/test",
    asyncRoute(async (req, res) => {
      const data = await marketplaceRegistry.testConnection(
        req.params.marketplace,
      );
      await audit.record({
        actor: req.user.username,
        action: "MARKETPLACE_CONNECTION_TESTED",
        entityType: "marketplace",
        entityId: String(req.params.marketplace).toUpperCase(),
        after: { ok: data.ok, code: data.code },
        ip: req.ip,
        requestId: req.id,
      });
      res.status(data.ok ? 200 : 409).json({
        status: data.ok ? "ok" : "waiting",
        code: data.code,
        message: data.message,
        data,
      });
    }),
  );
  r.post(
    "/integrations/hepsiburada/test",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await hepsiburada.health(),
      }),
    ),
  );
  r.post(
    "/integrations/trendyol/test",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await sync.trendyol?.listProducts?.(0, 1),
      }),
    ),
  );
  r.get(
    "/integrations/trendyol/image-diagnostics",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await sync.trendyol?.imageDiagnostics?.(req.query.size),
      }),
    ),
  );
  r.get(
    "/logs",
    asyncRoute(async (req, res) => {
      const [items, total] = await Promise.all([
        audit.list(req.query),
        audit.count ? audit.count(req.query) : 0,
      ]);
      res.json({ status: "ok", items, total: total || items.length });
    }),
  );
  r.get(
    "/audit-logs",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await audit.list({ ...req.query, type: "audit" }),
      }),
    ),
  );
  return r;
}
module.exports = { systemRoutes };
