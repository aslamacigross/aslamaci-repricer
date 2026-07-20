const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");
const { pagination } = require("../validators/common");

const strategies = new Set([
  "Manuel",
  "Sadece İzle",
  "Temkinli",
  "Normal",
  "Agresif",
  "Kâr Koru",
  "Buybox Odaklı",
  "Öğrenen Pilot",
]);
const modes = new Set(["MANUAL", "MONITOR", "AUTOMATIC"]);
const numericSettings = [
  "price_cut_tl",
  "max_increase_tl",
  "max_single_change_pct",
  "max_daily_change_pct",
  "minimum_profit_tl",
  "minimum_profit_pct",
  "minimum_margin_pct",
  "minimum_price",
  "maximum_price",
  "min_undercut_tl",
  "max_undercut_tl",
  "min_change_interval_minutes",
  "daily_action_limit",
  "buybox_max_age_minutes",
];

function validateSettings(input = {}) {
  if (input.strategy !== undefined && !strategies.has(input.strategy))
    throw new AppError("Geçersiz repricer stratejisi", 400, "VALIDATION_ERROR");
  if (input.mode !== undefined && !modes.has(input.mode))
    throw new AppError("Geçersiz çalışma modu", 400, "VALIDATION_ERROR");
  for (const field of numericSettings) {
    if (input[field] == null || input[field] === "") continue;
    if (!Number.isFinite(Number(input[field])) || Number(input[field]) < 0)
      throw new AppError(
        `${field} sıfır veya pozitif sayı olmalı`,
        400,
        "VALIDATION_ERROR",
      );
  }
  if (
    input.minimum_price != null &&
    input.maximum_price != null &&
    Number(input.maximum_price) < Number(input.minimum_price)
  )
    throw new AppError(
      "Maksimum fiyat minimum fiyattan küçük olamaz",
      400,
      "VALIDATION_ERROR",
    );
  return input;
}

function productFilters(query = {}) {
  return {
    ...query,
    active: query.active == null ? undefined : query.active === "true",
    stocked: query.stocked == null ? undefined : query.stocked === "true",
    autoUpdate:
      query.autoUpdate == null ? undefined : query.autoUpdate === "true",
  };
}

function bulkTarget(body = {}) {
  const barcodes = Array.isArray(body.barcodes)
    ? body.barcodes.map(String).filter(Boolean)
    : [];
  return {
    barcodes,
    filters: productFilters(body.filters || {}),
  };
}

function normalizeImageUrl(url) {
  if (!url) return null;
  const value = String(url).trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `https://cdn.dsmcdn.com${value}`;
  return `https://cdn.dsmcdn.com/${value.replace(/^\/+/, "")}`;
}

function productsRoutes({ products, costEngine, audit, repricer }) {
  const r = express.Router();
  const marketplace = (req) =>
    String(
      req.body?.marketplace || req.query?.marketplace || "TRENDYOL",
    ).toUpperCase();
  r.get(
    "/",
    asyncRoute(async (req, res) => {
      const page = pagination(req.query);
      const filters = productFilters({ ...req.query, ...page });
      res.json({ status: "ok", ...(await products.list(filters)) });
    }),
  );
  r.post(
    "/bulk-settings/preview",
    asyncRoute(async (req, res) => {
      const settings = validateSettings(req.body.settings || {});
      const target = { ...bulkTarget(req.body), marketplace: marketplace(req) };
      const data = await products.previewBulkSettings(target);
      res.json({ status: "ok", data: { ...data, settings } });
    }),
  );
  r.post(
    "/bulk-settings/apply",
    asyncRoute(async (req, res) => {
      const settings = validateSettings(req.body.settings || {});
      if (!Object.keys(settings).length)
        throw new AppError("En az bir ayar seçilmeli", 400, "VALIDATION_ERROR");
      const target = { ...bulkTarget(req.body), marketplace: marketplace(req) };
      const preview = await products.previewBulkSettings(target);
      if (!preview.total)
        throw new AppError("Uygulanacak ürün bulunamadı", 400, "NO_TARGETS");
      const data = await products.bulkUpdateSettings({
        target,
        input: settings,
        actor: req.user.username,
      });
      if (settings.minimum_profit_tl !== undefined) {
        for (const barcode of data.barcodes)
          await costEngine.recalculate(barcode, undefined, target.marketplace);
      }
      await audit.record({
        actor: req.user.username,
        action: "PRODUCT_SETTINGS_BULK_UPDATED",
        entityType: "product",
        entityId: "bulk",
        before: preview,
        after: { settings, updated: data.updated, sample: data.sample },
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data: { ...data, preview } });
    }),
  );
  r.get(
    "/:barcode/image",
    asyncRoute(async (req, res) => {
      const item = await products.get(req.params.barcode, marketplace(req));
      const imageUrl = normalizeImageUrl(item?.product_image_url);
      if (!imageUrl)
        throw new AppError("Ürün görseli bulunamadı", 404, "IMAGE_NOT_FOUND");
      const response = await fetch(imageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AslamaciERP/2.0; +https://aslamaci-repricer-production.up.railway.app)",
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
      if (!response.ok)
        throw new AppError("Ürün görseli alınamadı", 502, "IMAGE_FETCH_FAILED");
      const contentType = response.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/"))
        throw new AppError(
          "Ürün görseli geçersiz formatta",
          502,
          "IMAGE_INVALID_CONTENT_TYPE",
        );
      const buffer = Buffer.from(await response.arrayBuffer());
      res.set({
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400",
      });
      res.send(buffer);
    }),
  );
  r.get(
    "/:barcode",
    asyncRoute(async (req, res) => {
      const item = await products.get(req.params.barcode, marketplace(req));
      if (!item)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
      res.json({ status: "ok", data: item });
    }),
  );
  r.patch(
    "/:barcode",
    asyncRoute(async (req, res) => {
      const selectedMarketplace = marketplace(req);
      const before = await products.get(
        req.params.barcode,
        selectedMarketplace,
      );
      if (!before)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
      const data = await products.updateSettings(
        req.params.barcode,
        validateSettings(req.body),
        selectedMarketplace,
      );
      if (req.body.minimum_profit_tl !== undefined)
        await costEngine.recalculate(
          req.params.barcode,
          undefined,
          selectedMarketplace,
        );
      await audit.record({
        actor: req.user.username,
        action: "PRODUCT_SETTINGS_UPDATED",
        entityType: "product",
        entityId: req.params.barcode,
        before: before.settings,
        after: data,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.get(
    "/:barcode/cost-breakdown",
    asyncRoute(async (req, res) => {
      const data = await products.breakdown(
        req.params.barcode,
        marketplace(req),
      );
      if (!data)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
      res.json({ status: "ok", data });
    }),
  );
  for (const [type, path] of [
    ["buybox", "buybox-history"],
    ["price", "price-history"],
    ["repricer", "repricer-history"],
  ])
    r.get(
      `/:barcode/${path}`,
      asyncRoute(async (req, res) =>
        res.json({
          status: "ok",
          items: await products.history(
            req.params.barcode,
            type,
            marketplace(req),
          ),
        }),
      ),
    );
  r.post(
    "/:barcode/recalculate",
    asyncRoute(async (req, res) => {
      const data = await costEngine.recalculate(
        req.params.barcode,
        undefined,
        marketplace(req),
      );
      await audit.record({
        actor: req.user.username,
        action: "PRODUCT_COST_RECALCULATED",
        entityType: "product",
        entityId: req.params.barcode,
        after: data,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/:barcode/manual-price-action",
    asyncRoute(async (req, res) => {
      const price = Number(req.body.price);
      if (!Number.isFinite(price) || price <= 0)
        throw new AppError("Geçerli fiyat zorunlu", 400, "INVALID_PRICE");
      const data = await repricer.manualAction(
        req.params.barcode,
        price,
        req.user.username,
        { marketplace: marketplace(req) },
      );
      await audit.record({
        actor: req.user.username,
        action: "MANUAL_PRICE_ACTION_CREATED",
        entityType: "repricer_action",
        entityId: String(data.id),
        after: { barcode: req.params.barcode, price, status: data.status },
        ip: req.ip,
        requestId: req.id,
      });
      res.status(201).json({ status: "ok", data });
    }),
  );
  return r;
}
module.exports = { productsRoutes };
