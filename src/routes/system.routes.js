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
  r.post(
    "/jobs/:name/run",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await jobService.run(req.params.name, {
          source: "web",
          actor: req.user.username,
        }),
      }),
    ),
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
      const allowed = new Set([
        "global_dry_run",
        "global_repricer_enabled",
        "google_sheets_sync_enabled",
        "default_target_profit",
        "default_price_cut_tl",
        "global_max_price_change_pct",
        "default_carrier",
        "service_fee",
      ]);
      const changed = [];
      for (const [key, value] of Object.entries(req.body)) {
        if (!allowed.has(key))
          throw new AppError(
            `Ayar değiştirilemez: ${key}`,
            400,
            "SETTING_NOT_ALLOWED",
          );
        changed.push(await settings.set(key, value, req.user.username));
      }
      await audit.record({
        actor: req.user.username,
        action: "SYSTEM_SETTINGS_UPDATED",
        entityType: "system_settings",
        after: req.body,
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
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: await audit.list(req.query) }),
    ),
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
