const express = require("express");
const { asyncRoute } = require("../utils/errors");
function legacyRoutes({ dashboard, jobService, products }) {
  const r = express.Router();
  r.get(
    "/products-summary",
    asyncRoute(async (req, res) => {
      const data = await dashboard.get();
      res.json({ status: "ok", summary: data.kpis });
    }),
  );
  r.get(
    "/products",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        ...(await products.list({ ...req.query, limit: 200 })),
      }),
    ),
  );
  const jobs = {
    "/sync-products": "sync-products",
    "/sync-buybox": "sync-buybox",
    "/calculate-costs": "calculate-costs",
    "/run-full-refresh": "sheets-import",
    "/export-products-to-sheet": "sheets-export",
  };
  for (const [path, name] of Object.entries(jobs))
    r.post(
      path,
      asyncRoute(async (req, res) =>
        res.json({
          status: "ok",
          legacy: true,
          data: await jobService.run(name, { source: "legacy" }),
        }),
      ),
    );
  r.get("/apply-approved-prices", (req, res) =>
    res.status(410).json({
      status: "error",
      code: "LEGACY_PRICE_APPLY_DISABLED",
      message: "Fiyat gönderimi V2 güvenli aksiyon ekranına taşındı.",
    }),
  );
  r.get("/run-full-refresh", (req, res) =>
    res.status(405).json({
      status: "error",
      message:
        "Bu işlem artık giriş gerektiren POST /run-full-refresh ile çalışır.",
    }),
  );
  return r;
}
module.exports = { legacyRoutes };
