const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");

function rethrow(error) {
  if (error instanceof AppError) throw error;
  throw new AppError(
    error.message,
    error.status || 400,
    error.code || "PUBLICATION_ERROR",
  );
}

function publicationRoutes({ publication, audit }) {
  const r = express.Router();
  r.get(
    "/marketplace-categories",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await publication.listCategories(
          req.query.marketplace || "TRENDYOL",
        ),
      }),
    ),
  );
  r.get(
    "/marketplace-brands",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await publication.listBrands(
          req.query.marketplace || "TRENDYOL",
          req.query.search,
        ),
      }),
    ),
  );
  r.post(
    "/pim/recipes/:id/approve",
    asyncRoute(async (req, res) => {
      try {
        const data = await publication.approveRecipe(
          req.params.id,
          req.user.username,
          req.body.confirmation,
        );
        if (!data)
          throw new AppError("Reçete bulunamadı", 404, "RECIPE_NOT_FOUND");
        await audit.record({
          actor: req.user.username,
          action: "PIM_RECIPE_APPROVED",
          entityType: "pim_recipe",
          entityId: String(data.id),
          after: { status: data.status },
          ip: req.ip,
          requestId: req.id,
        });
        res.json({ status: "ok", data });
      } catch (error) {
        rethrow(error);
      }
    }),
  );
  r.get(
    "/publication-drafts",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await publication.listDrafts(req.query),
      }),
    ),
  );
  r.get(
    "/publication-drafts/:id",
    asyncRoute(async (req, res) => {
      const data = await publication.getDraft(req.params.id);
      if (!data)
        throw new AppError("Taslak bulunamadı", 404, "DRAFT_NOT_FOUND");
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/publication-drafts/preview",
    asyncRoute(async (req, res) => {
      try {
        res.json({
          status: "ok",
          data: await publication.buildPreview(req.body),
        });
      } catch (error) {
        rethrow(error);
      }
    }),
  );
  r.post(
    "/publication-drafts",
    asyncRoute(async (req, res) => {
      try {
        const data = await publication.createDraft(req.body, req.user.username);
        await audit.record({
          actor: req.user.username,
          action: "PUBLICATION_DRAFT_SAVED",
          entityType: "product_publication_draft",
          entityId: String(data.draft.id),
          after: {
            marketplace: data.draft.target_marketplace,
            workflowStatus: data.draft.workflow_status,
            dryRun: true,
          },
          ip: req.ip,
          requestId: req.id,
        });
        res.status(201).json({ status: "ok", data });
      } catch (error) {
        rethrow(error);
      }
    }),
  );
  r.post(
    "/publication-drafts/:id/publish-dry-run",
    asyncRoute(async (req, res) => {
      try {
        const data = await publication.publishDryRun(
          req.params.id,
          req.user.username,
          req.body.confirmation,
        );
        await audit.record({
          actor: req.user.username,
          action: "PRODUCT_PUBLISH_DRY_RUN",
          entityType: "product_publication_draft",
          entityId: String(req.params.id),
          after: {
            marketplace: data.draft.target_marketplace,
            mutationPerformed: false,
          },
          ip: req.ip,
          requestId: req.id,
        });
        res.json({ status: "ok", data });
      } catch (error) {
        rethrow(error);
      }
    }),
  );
  r.get(
    "/channel-transfers",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await publication.listTransferBatches(),
      }),
    ),
  );
  r.get(
    "/channel-transfers/:id",
    asyncRoute(async (req, res) => {
      const data = await publication.getTransferBatch(req.params.id);
      if (!data)
        throw new AppError("Aktarım bulunamadı", 404, "TRANSFER_NOT_FOUND");
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/channel-transfers",
    asyncRoute(async (req, res) => {
      try {
        const data = await publication.createTransfer(
          req.body,
          req.user.username,
        );
        await audit.record({
          actor: req.user.username,
          action: "CHANNEL_TRANSFER_PREVIEWED",
          entityType: "channel_transfer_batch",
          entityId: String(data.id),
          after: {
            source: data.source_marketplace,
            target: data.target_marketplace,
            total: data.total_count,
            ready: data.ready_count,
            blocked: data.blocked_count,
          },
          ip: req.ip,
          requestId: req.id,
        });
        res.status(201).json({ status: "ok", data });
      } catch (error) {
        rethrow(error);
      }
    }),
  );
  return r;
}

module.exports = { publicationRoutes };
