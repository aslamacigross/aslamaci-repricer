const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");
function systemRoutes({
  products,
  jobs,
  jobService,
  settings,
  audit,
  sheets,
  sync,
  costEngine,
}) {
  const r = express.Router();
  r.get(
    "/buybox",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        ...(await products.list({
          ...req.query,
          status: req.query.status || undefined,
          limit: req.query.limit || 100,
          sort: "rank",
        })),
      }),
    ),
  );
  r.post(
    "/sync/buybox",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await jobService.run("sync-buybox", { source: "web" }),
      }),
    ),
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
        "google_sheets_sync_enabled",
        "maintenance_mode",
        "default_target_profit",
        "default_price_cut_tl",
        "default_max_increase_tl",
        "global_max_price_change_pct",
        "default_carrier",
        "service_fee",
        "buybox_max_age_minutes",
        "product_sync_cron_minutes",
        "buybox_sync_cron_minutes",
        "cost_calculation_cron_minutes",
        "repricer_cron_minutes",
        "sheets_sync_cron_minutes",
        "log_retention_days",
      ]);
      const numeric = new Set([
        "default_target_profit",
        "default_price_cut_tl",
        "default_max_increase_tl",
        "global_max_price_change_pct",
        "service_fee",
        "buybox_max_age_minutes",
        "product_sync_cron_minutes",
        "buybox_sync_cron_minutes",
        "cost_calculation_cron_minutes",
        "repricer_cron_minutes",
        "sheets_sync_cron_minutes",
        "log_retention_days",
      ]);
      const booleanSettings = new Set([
        "global_dry_run",
        "global_repricer_enabled",
        "google_sheets_sync_enabled",
        "maintenance_mode",
      ]);
      const jobForSetting = {
        product_sync_cron_minutes: "sync-products",
        buybox_sync_cron_minutes: "sync-buybox",
        cost_calculation_cron_minutes: "calculate-costs",
        repricer_cron_minutes: "run-auto-repricer",
        sheets_sync_cron_minutes: "sheets-import",
      };
      const positive = new Set([
        "buybox_max_age_minutes",
        "product_sync_cron_minutes",
        "buybox_sync_cron_minutes",
        "cost_calculation_cron_minutes",
        "repricer_cron_minutes",
        "sheets_sync_cron_minutes",
        "log_retention_days",
      ]);
      const changed = [];
      let recalculateNeeded = false;
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
        if (key === "default_carrier" && !String(value || "").trim())
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
        if (key === "service_fee")
          await settings.applyServiceFeeToProducts(Number(value));
        if (["service_fee", "default_carrier"].includes(key))
          recalculateNeeded = true;
        if (jobForSetting[key])
          await jobs.update(jobForSetting[key], {
            schedule_minutes: Number(value),
            enabled: null,
          });
      }
      if (recalculateNeeded) await costEngine.recalculate();
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
    "/integrations",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: { google: sheets.health(), trendyol: await sync.health() },
      }),
    ),
  );
  r.post(
    "/integrations/google/test",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", data: await sheets.metadata() }),
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
  r.post(
    "/integrations/sheets/import",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await jobService.run("sheets-import", { source: "web" }),
      }),
    ),
  );
  r.post(
    "/integrations/sheets/export",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await jobService.run("sheets-export", { source: "web" }),
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
