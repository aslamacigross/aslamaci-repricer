const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");

function contentRoutes({ content, audit }) {
  const r = express.Router();
  r.get(
    "/content-drafts",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", ...(await content.listDrafts(req.query)) }),
    ),
  );
  r.get(
    "/content-drafts/:id",
    asyncRoute(async (req, res) => {
      const data = await content.getDraft(req.params.id);
      if (!data)
        throw new AppError(
          "İçerik taslağı bulunamadı",
          404,
          "CONTENT_DRAFT_NOT_FOUND",
        );
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/content-drafts/generate",
    asyncRoute(async (req, res) => {
      const data = await content.generate(req.body, req.user.username);
      await audit.record({
        actor: req.user.username,
        action: "CONTENT_DRAFT_GENERATED",
        entityType: "ai_content_draft",
        entityId: String(data.draft.id),
        after: {
          providerMode: data.draft.provider_mode,
          mutationPerformed: false,
        },
        ip: req.ip,
        requestId: req.id,
      });
      res.status(201).json({ status: "ok", data });
    }),
  );
  r.patch(
    "/content-drafts/:id",
    asyncRoute(async (req, res) => {
      const data = await content.update(
        req.params.id,
        req.body,
        req.user.username,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/content-drafts/:id/approve",
    asyncRoute(async (req, res) => {
      const data = await content.approve(
        req.params.id,
        req.user.username,
        req.body.confirmation,
      );
      await audit.record({
        actor: req.user.username,
        action: "CONTENT_DRAFT_APPROVED",
        entityType: "ai_content_draft",
        entityId: String(req.params.id),
        after: { status: data.workflow_status },
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/content-drafts/:id/publish-dry-run",
    asyncRoute(async (req, res) => {
      const data = await content.publishDryRun(
        req.params.id,
        req.user.username,
        req.body.confirmation,
      );
      await audit.record({
        actor: req.user.username,
        action: "CONTENT_PUBLISH_DRY_RUN",
        entityType: "ai_content_draft",
        entityId: String(req.params.id),
        after: { blockers: data.blockers, mutationPerformed: false },
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/content-drafts/:id/rollback-preview",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await content.rollbackPreview(req.params.id, req.body),
      }),
    ),
  );
  r.get(
    "/listing-health",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", ...(await content.listHealth(req.query)) }),
    ),
  );
  r.get(
    "/listing-health/:id",
    asyncRoute(async (req, res) => {
      const data = await content.getHealth(req.params.id);
      if (!data)
        throw new AppError(
          "Listing sağlık kaydı bulunamadı",
          404,
          "LISTING_HEALTH_NOT_FOUND",
        );
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/listing-health/scan",
    asyncRoute(async (req, res) => {
      const data = await content.scanHealth(req.body, req.user.username);
      await audit.record({
        actor: req.user.username,
        action: "LISTING_HEALTH_SCANNED",
        entityType: "listing_health",
        entityId: String(req.body.marketplace || "TRENDYOL"),
        after: { processed: data.processed, mutationPerformed: false },
        ip: req.ip,
        requestId: req.id,
      });
      res.status(201).json({ status: "ok", data });
    }),
  );
  return r;
}

module.exports = { contentRoutes };
