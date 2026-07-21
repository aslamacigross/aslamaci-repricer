const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");

function rethrow(error) {
  if (error instanceof AppError) throw error;
  if (error.status || error.code)
    throw new AppError(
      error.message,
      error.status || 400,
      error.code || "VALIDATION_ERROR",
    );
  throw error;
}

function pimRoutes({ pim, audit }) {
  const r = express.Router();
  r.get(
    "/pim/products",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        ...(await pim.listPhysicalProducts(req.query)),
      }),
    ),
  );
  r.get(
    "/pim/recipes",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", ...(await pim.listRecipes(req.query)) }),
    ),
  );
  r.get(
    "/pim/recipes/:id",
    asyncRoute(async (req, res) => {
      const data = await pim.getRecipe(req.params.id);
      if (!data)
        throw new AppError("Reçete bulunamadı", 404, "RECIPE_NOT_FOUND");
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/pim/recipes",
    asyncRoute(async (req, res) => {
      try {
        const data = await pim.createRecipe(req.body);
        await audit.record({
          actor: req.user.username,
          action: "PIM_RECIPE_CREATED",
          entityType: "pim_recipe",
          entityId: String(data.id),
          after: {
            recipeCode: data.recipe_code,
            fingerprint: data.bundle_fingerprint,
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
  r.get(
    "/pim/listings",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", ...(await pim.listListings(req.query)) }),
    ),
  );
  r.post(
    "/pim/bootstrap/preview",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", data: await pim.bootstrapPreview() }),
    ),
  );
  r.post(
    "/pim/bootstrap/apply",
    asyncRoute(async (req, res) => {
      if (req.body.confirmation !== "PIM_BOOTSTRAP_UYGULA")
        throw new AppError(
          "PIM aktarımı için açık onay gerekli",
          409,
          "PIM_BOOTSTRAP_CONFIRMATION_REQUIRED",
        );
      const data = await pim.bootstrap();
      await audit.record({
        actor: req.user.username,
        action: "PIM_BOOTSTRAP_APPLIED",
        entityType: "pim",
        entityId: "bootstrap",
        after: data,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.get(
    "/catalog-matches",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await pim.listCatalogMatches(req.query),
      }),
    ),
  );
  r.post(
    "/catalog-matches/preview",
    asyncRoute(async (req, res) => {
      try {
        res.json({
          status: "ok",
          items: await pim.previewCatalogMatches(req.body),
        });
      } catch (error) {
        rethrow(error);
      }
    }),
  );
  r.post(
    "/catalog-matches",
    asyncRoute(async (req, res) => {
      try {
        const data = await pim.saveCatalogMatch(req.body);
        res.status(201).json({ status: "ok", data });
      } catch (error) {
        rethrow(error);
      }
    }),
  );
  r.post(
    "/catalog-matches/:id/review",
    asyncRoute(async (req, res) => {
      try {
        const data = await pim.reviewCatalogMatch(
          req.params.id,
          req.body.status,
          req.user.username,
        );
        if (!data)
          throw new AppError(
            "Eşleşme bulunamadı",
            404,
            "CATALOG_MATCH_NOT_FOUND",
          );
        await audit.record({
          actor: req.user.username,
          action: "CATALOG_MATCH_REVIEWED",
          entityType: "marketplace_catalog_match",
          entityId: String(data.id),
          after: {
            status: data.match_status,
            confidence: data.match_confidence,
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
    "/listing-barcodes",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", ...(await pim.listBarcodePool(req.query)) }),
    ),
  );
  r.post(
    "/listing-barcodes/preview",
    asyncRoute(async (req, res) => {
      try {
        const data = await pim.previewBarcode(
          req.body.marketplace,
          req.body.recipeId,
        );
        if (!data)
          throw new AppError("Reçete bulunamadı", 404, "RECIPE_NOT_FOUND");
        res.json({ status: "ok", data });
      } catch (error) {
        rethrow(error);
      }
    }),
  );
  r.post(
    "/listing-barcodes/allocate",
    asyncRoute(async (req, res) => {
      try {
        const data = await pim.allocateBarcode(req.body);
        if (!data)
          throw new AppError("Reçete bulunamadı", 404, "RECIPE_NOT_FOUND");
        await audit.record({
          actor: req.user.username,
          action: "LISTING_BARCODE_RESERVED",
          entityType: "listing_barcode",
          entityId: String(data.id),
          after: {
            marketplace: data.marketplace,
            barcode: data.barcode,
            status: data.status,
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

module.exports = { pimRoutes };
