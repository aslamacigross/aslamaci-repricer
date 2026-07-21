const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");
function repricerRoutes({
  repricer,
  actions,
  actionService,
  jobService,
  learning,
  audit,
}) {
  const r = express.Router();
  const marketplace = (req) =>
    String(
      req.body?.marketplace || req.query?.marketplace || "TRENDYOL",
    ).toUpperCase();
  async function updateLearning(
    barcode,
    input,
    actor,
    action,
    selectedMarketplace,
  ) {
    const data = await actions.updateLearning(
      barcode,
      input,
      selectedMarketplace,
    );
    await audit.record({
      actor,
      action,
      entityType: "repricer_learning",
      entityId: barcode,
      after: data,
    });
    return data;
  }
  r.get(
    "/repricer/settings",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", data: await repricer.globalSettings() }),
    ),
  );
  r.post(
    "/repricer/preview",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await repricer.preview(req.body.barcode, marketplace(req)),
      }),
    ),
  );
  r.post(
    "/repricer/generate-actions",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await repricer.generate({
          barcode: req.body.barcode,
          source: "WEB",
          marketplace: marketplace(req),
        }),
      }),
    ),
  );
  r.post(
    "/repricer/run-dry",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        dryRun: true,
        data: await repricer.generate({
          barcode: req.body.barcode,
          source: "DRY_RUN",
          marketplace: marketplace(req),
        }),
      }),
    ),
  );
  r.post(
    "/repricer/run-auto",
    asyncRoute(async (req, res) => {
      repricer.ensureSupportedMarketplace(marketplace(req));
      res.json({
        status: "ok",
        data: await jobService.run("run-auto-repricer", { source: "web" }),
      });
    }),
  );
  r.get(
    "/actions",
    asyncRoute(async (req, res) => {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const filters = { ...req.query, page, limit };
      const [items, total] = await Promise.all([
        actions.list(filters),
        actions.count ? actions.count(filters) : null,
      ]);
      res.json({
        status: "ok",
        items,
        total: total ?? items.length,
        page,
        limit,
      });
    }),
  );
  r.get(
    "/actions/:id",
    asyncRoute(async (req, res) => {
      const data = await actions.get(req.params.id);
      if (!data) throw new AppError("Aksiyon bulunamadı", 404);
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/actions/:id/approve",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await actionService.approve(req.params.id, req.user.username),
      }),
    ),
  );
  r.post(
    "/actions/:id/edit-and-approve",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await actionService.editAndApprove(
          req.params.id,
          req.body,
          req.user.username,
        ),
      }),
    ),
  );
  r.post(
    "/actions/:id/reject",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await actionService.reject(req.params.id, req.user.username),
      }),
    ),
  );
  r.post(
    "/actions/:id/apply",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await actionService.apply(req.params.id, req.user.username),
      }),
    ),
  );
  r.post(
    "/actions/:id/revert",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await actionService.requestRevert(
          req.params.id,
          req.user.username,
        ),
      }),
    ),
  );
  r.post(
    "/actions/:id/recheck",
    asyncRoute(async (req, res) => {
      const action = await actions.get(req.params.id);
      if (!action) throw new AppError("Aksiyon bulunamadı", 404);
      res.json({
        status: "ok",
        data: await learning.checkOutcomes(
          Number(req.body.elapsedMinutes) || 5,
          req.params.id,
        ),
      });
    }),
  );
  r.post(
    "/actions/bulk-approve",
    asyncRoute(async (req, res) => {
      const items = await actionService.approveMany(
        req.body.ids,
        req.user.username,
      );
      res.json({ status: "ok", items });
    }),
  );
  r.get(
    "/learning",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await actions.learningList(undefined, marketplace(req)),
      }),
    ),
  );
  r.get(
    "/learning/:barcode",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await actions.learningDetail(
          req.params.barcode,
          marketplace(req),
        ),
      }),
    ),
  );
  r.patch(
    "/learning/:barcode",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await updateLearning(
          req.params.barcode,
          req.body,
          req.user.username,
          "REPRICER_LEARNING_UPDATED",
          marketplace(req),
        ),
      }),
    ),
  );
  r.post(
    "/learning/:barcode/reset",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await updateLearning(
          req.params.barcode,
          {
            learned_price_cut_tl: 0,
            learned_max_increase_tl: 0,
            consecutive_failures: 0,
            strategy: "Öğrenen Pilot",
            paused: false,
          },
          req.user.username,
          "REPRICER_LEARNING_RESET",
          marketplace(req),
        ),
      }),
    ),
  );
  r.post(
    "/learning/:barcode/pause",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await updateLearning(
          req.params.barcode,
          { paused: true },
          req.user.username,
          "REPRICER_LEARNING_PAUSED",
          marketplace(req),
        ),
      }),
    ),
  );
  r.post(
    "/learning/:barcode/resume",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await updateLearning(
          req.params.barcode,
          {
            paused: false,
            consecutive_failures: 0,
            strategy: "Öğrenen Pilot",
          },
          req.user.username,
          "REPRICER_LEARNING_RESUMED",
          marketplace(req),
        ),
      }),
    ),
  );
  return r;
}
module.exports = { repricerRoutes };
