const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");
const { requireFields, numeric } = require("../validators/common");

function positive(input, fields, { allowZero = false } = {}) {
  for (const field of fields) {
    const value = Number(input[field]);
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))
      throw new AppError(
        `${field} ${allowZero ? "negatif olmayan" : "pozitif"} sayı olmalı`,
        400,
        "VALIDATION_ERROR",
      );
  }
  return input;
}
function costsRoutes({ costs, costEngine, audit, shippingService }) {
  const r = express.Router();
  const logged = async (req, action, type, id, before, after) =>
    audit.record({
      actor: req.user.username,
      action,
      entityType: type,
      entityId: String(id || after?.id || ""),
      before,
      after,
      ip: req.ip,
      requestId: req.id,
    });
  r.get(
    "/cost-items",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: await costs.listCostItems() }),
    ),
  );
  r.post(
    "/cost-items",
    asyncRoute(async (req, res) => {
      numeric(
        requireFields(req.body, ["item_code", "item_name", "unit_cost"]),
        ["unit_cost", "unit_desi"],
      );
      positive(req.body, ["unit_cost"]);
      if (req.body.unit_desi !== undefined)
        positive(req.body, ["unit_desi"], { allowZero: true });
      const data = await costs.saveCostItem(req.body);
      await costEngine.recalculate();
      await logged(req, "COST_ITEM_CREATED", "cost_item", data.id, null, data);
      res.status(201).json({ status: "ok", data });
    }),
  );
  r.get(
    "/cost-items/:id/usage",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await costs.costItemUsage(req.params.id),
      }),
    ),
  );
  r.get(
    "/cost-items/:id/history",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await audit.entityHistory("cost_item", req.params.id),
      }),
    ),
  );
  r.patch(
    "/cost-items/:id",
    asyncRoute(async (req, res) => {
      numeric(
        requireFields(req.body, ["item_code", "item_name", "unit_cost"]),
        ["unit_cost", "unit_desi"],
      );
      positive(req.body, ["unit_cost"]);
      if (req.body.unit_desi !== undefined)
        positive(req.body, ["unit_desi"], { allowZero: true });
      const data = await costs.saveCostItem(req.body, req.params.id);
      if (!data) throw new AppError("Maliyet kalemi bulunamadı", 404);
      await costEngine.recalculate();
      await logged(req, "COST_ITEM_UPDATED", "cost_item", data.id, null, data);
      res.json({ status: "ok", data });
    }),
  );
  r.delete(
    "/cost-items/:id",
    asyncRoute(async (req, res) => {
      const data = await costs.deleteCostItem(req.params.id);
      if (!data) throw new AppError("Maliyet kalemi bulunamadı", 404);
      await costEngine.recalculate();
      await logged(req, "COST_ITEM_DELETED", "cost_item", data.id, data, null);
      res.json({ status: "ok" });
    }),
  );
  r.get(
    "/mappings",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: await costs.listMappings(req.query) }),
    ),
  );
  r.post(
    "/mappings/validate",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costs.validateMappings(req.body.rows),
      }),
    ),
  );
  r.post(
    "/mappings/preview",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costs.previewMappings(req.body.rows),
      }),
    ),
  );
  r.post(
    "/mappings/clone",
    asyncRoute(async (req, res) => {
      const data = await costs.cloneMappings(
        req.body.sourceBarcode,
        req.body.targetBarcodes,
      );
      for (const barcode of data.barcodes)
        await costEngine.recalculate(barcode);
      await logged(
        req,
        "MAPPINGS_CLONED",
        "mapping",
        req.body.sourceBarcode,
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/mappings/bulk-upsert",
    asyncRoute(async (req, res) => {
      const data = await costs.replaceMappingsForBarcodes(req.body.rows);
      for (const barcode of data.barcodes)
        await costEngine.recalculate(barcode);
      await logged(
        req,
        "MAPPINGS_BARCODE_SCOPED_REPLACE",
        "mapping",
        "TRENDYOL",
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/mappings/bulk",
    asyncRoute(async (req, res) => {
      if (req.body.confirmation !== "MAPPING_TAM_YENILE")
        throw new AppError(
          "Tüm mapping tablosunu yenilemek için açık onay gerekli",
          409,
          "FULL_MAPPING_REPLACE_CONFIRMATION_REQUIRED",
        );
      const data = await costs.replaceMappings(req.body.rows);
      await costEngine.recalculate();
      await logged(
        req,
        "MAPPINGS_ATOMIC_REPLACE",
        "mapping",
        "TRENDYOL",
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/mappings",
    asyncRoute(async (req, res) => {
      const data = await costs.upsertMapping(req.body);
      await costEngine.recalculate(req.body.barcode);
      await logged(req, "MAPPING_UPSERTED", "mapping", data.id, null, data);
      res.status(201).json({ status: "ok", data });
    }),
  );
  r.patch(
    "/mappings/:id",
    asyncRoute(async (req, res) => {
      const data = await costs.updateMapping(req.params.id, req.body);
      if (!data) throw new AppError("Mapping bulunamadı", 404);
      await costEngine.recalculate(data.barcode);
      if (data.old_barcode && data.old_barcode !== data.barcode)
        await costEngine.recalculate(data.old_barcode);
      await logged(req, "MAPPING_UPDATED", "mapping", data.id, null, data);
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/commissions/bulk",
    asyncRoute(async (req, res) => {
      const data = await costs.saveCommissions(req.body.rows);
      await costEngine.recalculate();
      await logged(
        req,
        "COMMISSIONS_BULK_UPDATED",
        "commission",
        "TRENDYOL",
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.delete(
    "/mappings/:id",
    asyncRoute(async (req, res) => {
      const data = await costs.deleteMapping(req.params.id);
      if (!data) throw new AppError("Mapping bulunamadı", 404);
      await costEngine.recalculate(data.barcode);
      await logged(req, "MAPPING_DELETED", "mapping", data.id, data, null);
      res.json({ status: "ok" });
    }),
  );
  r.get(
    "/commissions",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: await costs.listCommissions() }),
    ),
  );
  r.get(
    "/commissions/missing/categories",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await costs.missingCommissionCategories(),
      }),
    ),
  );
  r.get(
    "/commissions/:categoryId/history",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await audit.entityHistory("commission", req.params.categoryId),
      }),
    ),
  );
  r.post(
    "/commissions",
    asyncRoute(async (req, res) => {
      numeric(requireFields(req.body, ["category_id", "commission_rate"]), [
        "commission_rate",
      ]);
      if (
        Number(req.body.commission_rate) <= 0 ||
        Number(req.body.commission_rate) >= 100
      )
        throw new AppError(
          "Komisyon oranı 0 ile 100 arasında olmalı",
          400,
          "VALIDATION_ERROR",
        );
      const data = await costs.saveCommission(req.body);
      await costEngine.recalculate();
      await logged(
        req,
        "COMMISSION_SAVED",
        "commission",
        data.category_id,
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.patch(
    "/commissions/:categoryId",
    asyncRoute(async (req, res) => {
      numeric(requireFields(req.body, ["commission_rate"]), [
        "commission_rate",
      ]);
      if (
        Number(req.body.commission_rate) <= 0 ||
        Number(req.body.commission_rate) >= 100
      )
        throw new AppError(
          "Komisyon oranı 0 ile 100 arasında olmalı",
          400,
          "VALIDATION_ERROR",
        );
      const data = await costs.saveCommission({
        ...req.body,
        category_id: req.params.categoryId,
      });
      await costEngine.recalculate();
      await logged(
        req,
        "COMMISSION_UPDATED",
        "commission",
        data.category_id,
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.get(
    "/shipping",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", data: await costs.shipping() }),
    ),
  );
  r.post(
    "/shipping/preview",
    asyncRoute(async (req, res) => {
      numeric(requireFields(req.body, ["sale_price", "desi", "carrier"]), [
        "sale_price",
        "desi",
      ]);
      positive(req.body, ["sale_price", "desi"]);
      res.json({
        status: "ok",
        data: await shippingService.preview(req.body),
      });
    }),
  );
  r.get(
    "/shipping/coverage",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", data: await shippingService.coverage() }),
    ),
  );
  r.get(
    "/shipping/rates",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: (await costs.shipping()).rates }),
    ),
  );
  r.get(
    "/shipping/barems",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: (await costs.shipping()).barems }),
    ),
  );
  r.get(
    "/packaging-rules",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: (await costs.shipping()).packaging }),
    ),
  );
  r.post(
    "/shipping/rates",
    asyncRoute(async (req, res) => {
      numeric(requireFields(req.body, ["desi_kg", "carrier", "cost_ex_vat"]), [
        "desi_kg",
        "cost_ex_vat",
        "vat_rate",
      ]);
      positive(req.body, ["desi_kg"], { allowZero: true });
      positive(req.body, ["cost_ex_vat"]);
      const data = await costs.saveShippingRate(req.body);
      await costEngine.recalculate();
      await logged(
        req,
        "SHIPPING_RATE_SAVED",
        "shipping_rate",
        data.id,
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.patch(
    "/shipping/rates/:id",
    asyncRoute(async (req, res) => {
      numeric(requireFields(req.body, ["desi_kg", "carrier", "cost_ex_vat"]), [
        "desi_kg",
        "cost_ex_vat",
        "vat_rate",
      ]);
      positive(req.body, ["desi_kg"], { allowZero: true });
      positive(req.body, ["cost_ex_vat"]);
      const data = await costs.saveShippingRate(req.body, req.params.id);
      if (!data) throw new AppError("Kargo tarifesi bulunamadı", 404);
      await costEngine.recalculate();
      await logged(
        req,
        "SHIPPING_RATE_UPDATED",
        "shipping_rate",
        data.id,
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.delete(
    "/shipping/rates/:id",
    asyncRoute(async (req, res) => {
      const data = await costs.deleteShippingRate(req.params.id);
      if (!data) throw new AppError("Kargo tarifesi bulunamadı", 404);
      await costEngine.recalculate();
      await logged(
        req,
        "SHIPPING_RATE_DELETED",
        "shipping_rate",
        data.id,
        data,
        null,
      );
      res.json({ status: "ok" });
    }),
  );
  r.post(
    "/shipping/barems",
    asyncRoute(async (req, res) => {
      numeric(
        requireFields(req.body, [
          "min_basket",
          "max_basket",
          "carrier",
          "cost_ex_vat",
        ]),
        ["min_basket", "max_basket", "cost_ex_vat", "vat_rate"],
      );
      if (Number(req.body.max_basket) <= Number(req.body.min_basket))
        throw new AppError(
          "Maksimum sepet minimumdan büyük olmalı",
          400,
          "VALIDATION_ERROR",
        );
      positive(req.body, ["min_basket"], { allowZero: true });
      positive(req.body, ["max_basket", "cost_ex_vat"]);
      const data = await costs.saveBarem(req.body);
      await costEngine.recalculate();
      await logged(
        req,
        "SHIPPING_BAREM_SAVED",
        "shipping_barem",
        data.id,
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.patch(
    "/shipping/barems/:id",
    asyncRoute(async (req, res) => {
      numeric(
        requireFields(req.body, [
          "min_basket",
          "max_basket",
          "carrier",
          "cost_ex_vat",
        ]),
        ["min_basket", "max_basket", "cost_ex_vat", "vat_rate"],
      );
      if (Number(req.body.max_basket) <= Number(req.body.min_basket))
        throw new AppError(
          "Maksimum sepet minimumdan büyük olmalı",
          400,
          "VALIDATION_ERROR",
        );
      positive(req.body, ["min_basket"], { allowZero: true });
      positive(req.body, ["max_basket", "cost_ex_vat"]);
      const data = await costs.saveBarem(req.body, req.params.id);
      if (!data) throw new AppError("Kargo baremi bulunamadı", 404);
      await costEngine.recalculate();
      await logged(
        req,
        "SHIPPING_BAREM_UPDATED",
        "shipping_barem",
        data.id,
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.delete(
    "/shipping/barems/:id",
    asyncRoute(async (req, res) => {
      const data = await costs.deleteBarem(req.params.id);
      if (!data) throw new AppError("Kargo baremi bulunamadı", 404);
      await costEngine.recalculate();
      await logged(
        req,
        "SHIPPING_BAREM_DELETED",
        "shipping_barem",
        data.id,
        data,
        null,
      );
      res.json({ status: "ok" });
    }),
  );
  r.post(
    "/packaging-rules",
    asyncRoute(async (req, res) => {
      numeric(
        requireFields(req.body, ["min_desi", "max_desi", "packaging_cost"]),
        ["min_desi", "max_desi", "packaging_cost"],
      );
      positive(req.body, ["min_desi", "packaging_cost"], { allowZero: true });
      positive(req.body, ["max_desi"]);
      if (Number(req.body.max_desi) <= Number(req.body.min_desi))
        throw new AppError(
          "Maksimum desi minimumdan büyük olmalı",
          400,
          "VALIDATION_ERROR",
        );
      const data = await costs.savePackaging(req.body);
      await costEngine.recalculate();
      await logged(
        req,
        "PACKAGING_RULE_SAVED",
        "packaging_rule",
        data.id,
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.patch(
    "/packaging-rules/:id",
    asyncRoute(async (req, res) => {
      numeric(
        requireFields(req.body, ["min_desi", "max_desi", "packaging_cost"]),
        ["min_desi", "max_desi", "packaging_cost"],
      );
      positive(req.body, ["min_desi", "packaging_cost"], { allowZero: true });
      positive(req.body, ["max_desi"]);
      if (Number(req.body.max_desi) <= Number(req.body.min_desi))
        throw new AppError(
          "Maksimum desi minimumdan büyük olmalı",
          400,
          "VALIDATION_ERROR",
        );
      const data = await costs.savePackaging(req.body, req.params.id);
      if (!data) throw new AppError("Ambalaj kuralı bulunamadı", 404);
      await costEngine.recalculate();
      await logged(
        req,
        "PACKAGING_RULE_UPDATED",
        "packaging_rule",
        data.id,
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
  );
  r.delete(
    "/packaging-rules/:id",
    asyncRoute(async (req, res) => {
      const data = await costs.deletePackaging(req.params.id);
      if (!data) throw new AppError("Ambalaj kuralı bulunamadı", 404);
      await costEngine.recalculate();
      await logged(
        req,
        "PACKAGING_RULE_DELETED",
        "packaging_rule",
        data.id,
        data,
        null,
      );
      res.json({ status: "ok" });
    }),
  );
  return r;
}
module.exports = { costsRoutes };
