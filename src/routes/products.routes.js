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
function productsRoutes({ products, costEngine, audit, repricer }) {
  const r = express.Router();
  r.get(
    "/",
    asyncRoute(async (req, res) => {
      const page = pagination(req.query);
      const filters = {
        ...req.query,
        ...page,
        active:
          req.query.active == null ? undefined : req.query.active === "true",
        stocked:
          req.query.stocked == null ? undefined : req.query.stocked === "true",
        autoUpdate:
          req.query.autoUpdate == null
            ? undefined
            : req.query.autoUpdate === "true",
      };
      res.json({ status: "ok", ...(await products.list(filters)) });
    }),
  );
  r.get(
    "/:barcode",
    asyncRoute(async (req, res) => {
      const item = await products.get(req.params.barcode);
      if (!item)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
      res.json({ status: "ok", data: item });
    }),
  );
  r.patch(
    "/:barcode",
    asyncRoute(async (req, res) => {
      const before = await products.get(req.params.barcode);
      if (!before)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
      const data = await products.updateSettings(
        req.params.barcode,
        validateSettings(req.body),
      );
      if (req.body.minimum_profit_tl !== undefined)
        await costEngine.recalculate(req.params.barcode);
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
      const data = await products.breakdown(req.params.barcode);
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
          items: await products.history(req.params.barcode, type),
        }),
      ),
    );
  r.post(
    "/:barcode/recalculate",
    asyncRoute(async (req, res) => {
      const data = await costEngine.recalculate(req.params.barcode);
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
