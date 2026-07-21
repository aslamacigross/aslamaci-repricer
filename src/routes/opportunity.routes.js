const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");

function opportunityRoutes({ opportunity, audit }) {
  const r = express.Router();
  r.get(
    "/opportunities",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", ...(await opportunity.list(req.query)) }),
    ),
  );
  r.get(
    "/opportunities/:id",
    asyncRoute(async (req, res) => {
      const data = await opportunity.get(req.params.id);
      if (!data)
        throw new AppError("Fırsat bulunamadı", 404, "OPPORTUNITY_NOT_FOUND");
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/opportunities/generate",
    asyncRoute(async (req, res) => {
      const data = await opportunity.generate(req.body, req.user.username);
      await audit.record({
        actor: req.user.username,
        action: "PRODUCT_OPPORTUNITIES_GENERATED",
        entityType: "product_opportunity",
        entityId: data.targetMarketplace,
        after: {
          generated: data.generated,
          evaluated: data.evaluated,
          mutationPerformed: false,
        },
        ip: req.ip,
        requestId: req.id,
      });
      res.status(201).json({ status: "ok", data });
    }),
  );
  r.post(
    "/opportunities/:id/approve-recipe",
    asyncRoute(async (req, res) => {
      const data = await opportunity.approve(
        req.params.id,
        req.user.username,
        req.body.confirmation,
      );
      await audit.record({
        actor: req.user.username,
        action: "OPPORTUNITY_RECIPE_APPROVED",
        entityType: "product_opportunity",
        entityId: String(req.params.id),
        after: { recipeId: data.recipe_id, status: data.workflow_status },
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/opportunities/:id/reject",
    asyncRoute(async (req, res) => {
      const data = await opportunity.reject(
        req.params.id,
        req.user.username,
        req.body,
      );
      await audit.record({
        actor: req.user.username,
        action: "OPPORTUNITY_REJECTED",
        entityType: "product_opportunity",
        entityId: String(req.params.id),
        after: { reason: data.rejection_reason, status: data.workflow_status },
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/opportunities/:id/catalog-search",
    asyncRoute(async (req, res) => {
      const data = await opportunity.searchCatalog(
        req.params.id,
        req.user.username,
      );
      await audit.record({
        actor: req.user.username,
        action: "OPPORTUNITY_CATALOG_SEARCHED",
        entityType: "product_opportunity",
        entityId: String(req.params.id),
        after: { code: data.outcome?.code, mutationPerformed: false },
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  return r;
}

module.exports = { opportunityRoutes };
