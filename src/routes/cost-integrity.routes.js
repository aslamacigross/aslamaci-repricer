const express = require("express");
const { asyncRoute } = require("../utils/errors");

function costIntegrityRoutes({ costIntegrity }) {
  const router = express.Router();
  const actor = (req) => req.user.username;

  router.get(
    "/cost-integrity/legacy-backfill/preview",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costIntegrity.legacyBackfillPreview(),
      }),
    ),
  );

  router.post(
    "/cost-integrity/legacy-backfill/apply",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costIntegrity.applyLegacyBackfill({
          ...req.body,
          actor: actor(req),
        }),
      }),
    ),
  );

  router.post(
    "/cost-integrity/preview",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costIntegrity.preview(
          req.body?.operationType,
          req.body?.payload || {},
        ),
      }),
    ),
  );

  router.post(
    "/cost-integrity/apply",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costIntegrity.apply({
          ...req.body,
          actor: actor(req),
        }),
      }),
    ),
  );

  router.post(
    "/cost-integrity/operations/:id/reverse",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costIntegrity.reverse(req.params.id, {
          ...req.body,
          actor: actor(req),
        }),
      }),
    ),
  );

  router.get(
    "/cost-integrity/cost-items/:id/hard-delete-eligibility",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costIntegrity.hardDeleteEligibility(req.params.id),
      }),
    ),
  );

  router.get(
    "/cost-integrity/cost-items",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costIntegrity.searchCostItems(req.query),
      }),
    ),
  );

  router.get(
    "/cost-integrity/cost-items/:id/context",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costIntegrity.costItemContext(req.params.id),
      }),
    ),
  );

  router.get(
    "/cost-integrity/operations/:id",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costIntegrity.operation(req.params.id),
      }),
    ),
  );

  return router;
}

module.exports = { costIntegrityRoutes };
