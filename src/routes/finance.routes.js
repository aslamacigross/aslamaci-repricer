const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");

function financeRoutes({ finance, jobService, audit }) {
  const router = express.Router();
  router.get(
    "/finance/monthly",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await finance.monthlyReport(
          req.query.month,
          req.query.marketplace || "TRENDYOL",
        ),
      }),
    ),
  );
  router.put(
    "/finance/packaging",
    asyncRoute(async (req, res) => {
      if (!/^\d{4}-\d{2}$/.test(String(req.body.month || "")))
        throw new AppError(
          "Ay YYYY-AA formatında olmalı",
          400,
          "INVALID_MONTH",
        );
      if (
        !Number.isFinite(Number(req.body.amount)) ||
        Number(req.body.amount) < 0
      )
        throw new AppError("Ambalaj gideri geçersiz", 400, "INVALID_AMOUNT");
      const data = await finance.setPackagingExpense(
        req.body.month,
        req.body.amount,
        req.user.username,
        req.body.note,
        req.body.marketplace || "TRENDYOL",
      );
      await audit.record({
        actor: req.user.username,
        action: "MONTHLY_PACKAGING_UPDATED",
        entityType: "finance",
        entityId: `${req.body.marketplace || "TRENDYOL"}:${req.body.month}`,
        after: data,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  router.post(
    "/finance/sync",
    asyncRoute(async (req, res) => {
      const marketplace = String(
        req.body.marketplace || "TRENDYOL",
      ).toUpperCase();
      if (marketplace === "HEPSIBURADA") {
        const orders = await jobService.run("sync-hepsiburada-orders", {
          source: "web",
          actor: req.user.username,
        });
        return res.json({
          status: "ok",
          data: { marketplace, orders, transactions: null },
        });
      }
      if (marketplace !== "TRENDYOL")
        throw new AppError(
          "Pazaryeri desteklenmiyor",
          400,
          "MARKETPLACE_NOT_SUPPORTED",
        );
      const orders = await jobService.run("sync-orders", {
        source: "web",
        actor: req.user.username,
      });
      const transactions = await jobService.run("sync-financial-transactions", {
        source: "web",
        actor: req.user.username,
      });
      return res.json({
        status: "ok",
        data: { marketplace, orders, transactions },
      });
    }),
  );
  return router;
}

module.exports = { financeRoutes };
