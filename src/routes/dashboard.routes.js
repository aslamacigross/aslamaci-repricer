const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");

const LIVE_REFRESH_JOBS = [
  "sync-products",
  "calculate-costs",
  "sync-buybox",
  "dashboard-cache-refresh",
];

function formatJobRun(run) {
  return {
    id: run.id || null,
    job_name: run.job_name || null,
    status: run.status,
    processed_count: run.processed_count ?? run.processed ?? 0,
    successful_count: run.successful_count ?? run.successful ?? 0,
    failed_count: run.failed_count ?? run.failed ?? 0,
    error: run.error || null,
    duration_ms: run.duration_ms || null,
  };
}

function dashboardRoutes({ dashboard, jobService, audit }) {
  const r = express.Router();
  const marketplace = (value) => {
    const normalized = String(value || "TRENDYOL").toUpperCase();
    if (!new Set(["TRENDYOL", "HEPSIBURADA"]).has(normalized))
      throw new AppError("Geçersiz pazaryeri", 400, "INVALID_MARKETPLACE");
    return normalized;
  };
  r.get(
    "/",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await dashboard.get({
          marketplace: marketplace(req.query.marketplace),
        }),
      }),
    ),
  );
  r.post(
    "/live-refresh",
    asyncRoute(async (req, res) => {
      const selectedMarketplace = marketplace(req.body.marketplace);
      const runs = [];
      if (selectedMarketplace === "TRENDYOL") {
        for (const name of LIVE_REFRESH_JOBS) {
          const run = await jobService.run(name, {
            source: "dashboard-live-refresh",
            actor: req.user.username,
          });
          runs.push({ ...formatJobRun(run), job_name: run.job_name || name });
        }
      }
      const data = await dashboard.get({
        fresh: true,
        marketplace: selectedMarketplace,
      });
      await audit.record({
        actor: req.user.username,
        action: "DASHBOARD_LIVE_REFRESH",
        entityType: "dashboard",
        entityId: selectedMarketplace,
        after: { marketplace: selectedMarketplace, jobs: runs },
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data: { dashboard: data, runs } });
    }),
  );
  r.get(
    "/metrics/:metric",
    asyncRoute(async (req, res) => {
      const data = await dashboard.metricDetails(req.params.metric, {
        limit: req.query.limit,
        marketplace: marketplace(req.query.marketplace),
      });
      if (!data)
        throw new AppError("Dashboard metriği bulunamadı", 404, "NOT_FOUND");
      res.json({ status: "ok", data });
    }),
  );
  return r;
}
module.exports = { dashboardRoutes };
