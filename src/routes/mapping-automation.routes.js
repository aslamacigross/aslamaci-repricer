const express = require("express");
const { asyncRoute } = require("../utils/errors");

function mappingAutomationRoutes({ mappingAutomation, audit }) {
  const router = express.Router();
  const log = (req, action, entityId, after) =>
    audit.record({
      actor: req.user.username,
      action,
      entityType: "mapping_suggestion",
      entityId: String(entityId || ""),
      before: null,
      after,
      ip: req.ip,
      requestId: req.id,
    });

  router.get(
    "/file-market/items",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await mappingAutomation.listFileItems(req.query),
      }),
    ),
  );
  router.post(
    "/file-market/items/bulk",
    asyncRoute(async (req, res) => {
      const data = await mappingAutomation.importFileItems(req.body.rows);
      await log(req, "FILE_MARKET_PRICES_IMPORTED", "file-market", {
        processed: data.processed,
        created: data.created,
        changed: data.changed,
      });
      res.json({ status: "ok", data });
    }),
  );

  router.post(
    "/mapping-suggestions/generate",
    asyncRoute(async (req, res) => {
      const data = await mappingAutomation.generate(req.body || {});
      await log(req, "MAPPING_SUGGESTIONS_GENERATED", "bulk", data);
      res.json({ status: "ok", data });
    }),
  );
  router.get(
    "/mapping-suggestions",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await mappingAutomation.listSuggestions(req.query),
      }),
    ),
  );
  router.post(
    "/mapping-suggestions/bulk-preview",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await mappingAutomation.bulkPreview(req.body.ids),
      }),
    ),
  );
  router.post(
    "/mapping-suggestions/bulk-apply",
    asyncRoute(async (req, res) => {
      const data = await mappingAutomation.bulkApply(
        req.body.ids,
        req.body.previewToken,
        req.user.username,
      );
      await log(req, "MAPPING_SUGGESTIONS_APPLIED", "bulk", data);
      res.json({ status: "ok", data });
    }),
  );
  router.get(
    "/mapping-suggestions/:id",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await mappingAutomation.getSuggestion(req.params.id),
      }),
    ),
  );
  router.post(
    "/mapping-suggestions/:id/approve",
    asyncRoute(async (req, res) => {
      const data = await mappingAutomation.approve(
        req.params.id,
        req.user.username,
        req.body,
      );
      await log(req, "MAPPING_SUGGESTION_APPROVED", data.id, {
        barcode: data.barcode,
        confidence: data.confidence,
        updateFilePrice: data.update_file_price,
      });
      res.json({ status: "ok", data });
    }),
  );
  router.post(
    "/mapping-suggestions/:id/reject",
    asyncRoute(async (req, res) => {
      const data = await mappingAutomation.reject(
        req.params.id,
        req.user.username,
        req.body,
      );
      await log(req, "MAPPING_SUGGESTION_REJECTED", data.id, {
        barcode: data.barcode,
        reason: data.rejection_reason,
      });
      res.json({ status: "ok", data });
    }),
  );
  return router;
}

module.exports = { mappingAutomationRoutes };
