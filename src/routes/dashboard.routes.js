const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");

const LIVE_REFRESH_JOBS = [
  "sync-products",
  "calculate-costs",
  "sync-buybox",
  "dashboard-cache-refresh",
];
const HEPSIBURADA_LIVE_REFRESH_JOBS = [
  "sync-hepsiburada-products",
  "sync-hepsiburada-buybox",
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

function summarizeRepricerDecision(preview, { openAction, increaseProbe }) {
  if (!preview)
    return {
      repricer_decision: "ONIZLEME_YOK",
      repricer_action: null,
      repricer_proposed_price: null,
      repricer_difference: null,
      repricer_blocked_reasons: ["REPRICER_PREVIEW_MISSING"],
      repricer_reason: "Repricer bu ürün için önizleme üretemedi",
    };
  const blockedReasons = preview.blockedReasons || [];
  const blockingSafetyFailures = blockedReasons.filter(
    (code) => !["DRY_RUN", "GLOBAL_REPRICER_DISABLED"].includes(code),
  );
  let decision = "AKSIYON_URETILEBILIR";
  let reason = preview.reason || preview.humanReadableReason || "";
  if (preview.action === "KORU") {
    decision = "KORU";
    reason ||= "Repricer fiyatı korumayı uygun gördü";
  } else if (blockingSafetyFailures.length) {
    decision = "SAFETY_BLOCKED";
    reason = blockingSafetyFailures.join(", ");
  } else if (increaseProbe) {
    decision = "BUYBOX_INCREASE_OUTCOME_PENDING";
    reason =
      "Buybox bizdeyken yapılan fiyat artışı yoklamasının sonucu bekleniyor";
  } else if (openAction) {
    decision = "OPEN_ACTION_EXISTS";
    reason = "Ürün için kapanmamış fiyat aksiyonu var";
  }
  return {
    repricer_decision: decision,
    repricer_action: preview.action,
    repricer_proposed_price: preview.proposedPrice,
    repricer_difference: preview.difference,
    repricer_blocked_reasons: blockingSafetyFailures,
    repricer_reason: reason,
    repricer_target_rank: preview.targetRank,
    repricer_expected_profit: preview.expectedProfit,
  };
}

async function enrichMetricWithRepricerDiagnostics(
  data,
  { repricer, actions, marketplace },
) {
  if (
    !data ||
    data.type !== "products" ||
    !repricer ||
    !Array.isArray(data.items) ||
    !data.items.length
  )
    return data;
  const barcodes = data.items.map((row) => row.barcode).filter(Boolean);
  if (!barcodes.length) return data;
  const previews = await repricer.preview(barcodes, marketplace);
  const previewByBarcode = new Map(
    previews.map((preview) => [preview.barcode, preview]),
  );
  const items = [];
  for (const row of data.items) {
    const preview = previewByBarcode.get(row.barcode);
    const [openAction, increaseProbe] = await Promise.all([
      actions?.findOpen?.(row.barcode, undefined, null, marketplace),
      preview?.action === "FIYAT_ARTIR" && Number(preview.rank) === 1
        ? actions?.findPendingIncreaseProbe?.(row.barcode, marketplace)
        : null,
    ]);
    items.push({
      ...row,
      ...summarizeRepricerDecision(preview, {
        openAction,
        increaseProbe,
      }),
    });
  }
  return { ...data, items };
}

function dashboardRoutes({ dashboard, jobService, audit, repricer, actions }) {
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
      const refreshJobs =
        selectedMarketplace === "TRENDYOL"
          ? LIVE_REFRESH_JOBS
          : HEPSIBURADA_LIVE_REFRESH_JOBS;
      for (const name of refreshJobs) {
        const run = await jobService.run(name, {
          source: "dashboard-live-refresh",
          actor: req.user.username,
        });
        runs.push({ ...formatJobRun(run), job_name: run.job_name || name });
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
      const selectedMarketplace = marketplace(req.query.marketplace);
      const data = await dashboard.metricDetails(req.params.metric, {
        limit: req.query.limit,
        marketplace: selectedMarketplace,
      });
      if (!data)
        throw new AppError("Dashboard metriği bulunamadı", 404, "NOT_FOUND");
      res.json({
        status: "ok",
        data: await enrichMetricWithRepricerDiagnostics(data, {
          repricer,
          actions,
          marketplace: selectedMarketplace,
        }),
      });
    }),
  );
  return r;
}
module.exports = {
  dashboardRoutes,
  summarizeRepricerDecision,
  enrichMetricWithRepricerDiagnostics,
};
