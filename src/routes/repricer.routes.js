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
  async function updateLearning(barcode, input, actor, action) {
    const data = await actions.updateLearning(barcode, input);
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
        items: await repricer.preview(req.body.barcode),
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
        }),
      }),
    ),
  );
  r.post(
    "/repricer/run-auto",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await jobService.run("run-auto-repricer", { source: "web" }),
      }),
    ),
  );
  r.get(
    "/actions",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: await actions.list(req.query) }),
    ),
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
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await learning.checkOutcomes(
          Number(req.body.elapsedMinutes) || 5,
        ),
      }),
    ),
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
      res.json({ status: "ok", items: await actions.learningList() }),
    ),
  );
  r.get(
    "/learning/:barcode",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: (await actions.learningList(req.params.barcode))[0] || null,
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
        ),
      }),
    ),
  );
  return r;
}
module.exports = { repricerRoutes };
