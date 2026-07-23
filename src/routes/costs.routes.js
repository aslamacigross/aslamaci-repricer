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

function normalizeCostItemRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0)
    throw new AppError("Maliyet kalemi listesi boş", 400, "EMPTY_COST_ITEMS");
  if (rows.length > 1000)
    throw new AppError(
      "Tek işlemde en fazla 1000 maliyet kalemi yüklenebilir",
      400,
      "TOO_MANY_COST_ITEMS",
    );
  const seen = new Set();
  return rows.map((row, index) => {
    const item = {
      item_code: String(row.item_code || "").trim(),
      item_name: String(row.item_name || "").trim(),
      unit_cost: Number(row.unit_cost),
      unit_desi: Number(row.unit_desi || 0),
      unit: String(row.unit || "adet").trim() || "adet",
      note: String(row.note || "").trim(),
    };
    if (
      !item.item_code ||
      !item.item_name ||
      !Number.isFinite(item.unit_cost) ||
      item.unit_cost <= 0 ||
      !Number.isFinite(item.unit_desi) ||
      item.unit_desi < 0
    )
      throw new AppError(
        `${index + 1}. maliyet kalemi satırı geçersiz`,
        400,
        "INVALID_COST_ITEM_ROW",
      );
    if (seen.has(item.item_code))
      throw new AppError(
        `${item.item_code} aynı yüklemede birden fazla kez kullanılmış`,
        400,
        "DUPLICATE_COST_ITEM_CODE",
      );
    seen.add(item.item_code);
    return item;
  });
}

function validatePackagingRule(input) {
  const scope = String(input.rule_scope || "DESI").toUpperCase();
  if (!["DESI", "BARCODE", "PRODUCT_NAME", "CATEGORY", "BRAND"].includes(scope))
    throw new AppError(
      "Ambalaj eşleşme türü geçersiz",
      400,
      "VALIDATION_ERROR",
    );
  numeric(requireFields(input, ["packaging_cost"]), ["packaging_cost"]);
  positive(input, ["packaging_cost"], { allowZero: true });
  if (!String(input.profile_name || input.note || "").trim())
    throw new AppError("Profil adı gerekli", 400, "VALIDATION_ERROR");
  if (scope === "DESI") {
    numeric(requireFields(input, ["min_desi", "max_desi"]), [
      "min_desi",
      "max_desi",
    ]);
    positive(input, ["min_desi"], { allowZero: true });
    positive(input, ["max_desi"]);
    if (Number(input.max_desi) <= Number(input.min_desi))
      throw new AppError(
        "Maksimum desi minimumdan büyük olmalı",
        400,
        "VALIDATION_ERROR",
      );
  } else if (!String(input.match_value || "").trim()) {
    throw new AppError("Eşleşme değeri gerekli", 400, "VALIDATION_ERROR");
  }
  if (input.priority !== undefined) {
    numeric(input, ["priority"]);
    positive(input, ["priority"], { allowZero: true });
  }
  return input;
}
function costsRoutes({
  costs,
  costEngine,
  audit,
  shippingService,
  shippingTariff,
  desi,
}) {
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
  const recalculateAllMarketplaces = async () => {
    await costEngine.recalculate(undefined, undefined, "TRENDYOL");
    await costEngine.recalculate(undefined, undefined, "HEPSIBURADA");
  };
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
      await recalculateAllMarketplaces();
      await logged(req, "COST_ITEM_CREATED", "cost_item", data.id, null, data);
      res.status(201).json({ status: "ok", data });
    }),
  );
  r.post(
    "/cost-items/bulk",
    asyncRoute(async (req, res) => {
      const rows = normalizeCostItemRows(req.body.rows);
      const data = await costs.saveCostItems(rows);
      await recalculateAllMarketplaces();
      await logged(req, "COST_ITEMS_BULK_UPSERTED", "cost_item", "bulk", null, {
        processed: data.processed,
        itemCodes: rows.map((row) => row.item_code),
      });
      res.json({ status: "ok", data });
    }),
  );
  r.get(
    "/cost-items/duplicates",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await costs.duplicateCostItemCandidates(req.query),
      }),
    ),
  );
  r.get(
    "/cost-items/desi-review",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await desi.listReviewQueue(req.query),
      }),
    ),
  );
  r.post(
    "/cost-items/desi-review/:itemCode/resolve",
    asyncRoute(async (req, res) => {
      const value = Number(req.body.unit_desi);
      if (!Number.isFinite(value) || value <= 0)
        throw new AppError(
          "Desi pozitif bir sayı olmalı",
          400,
          "VALIDATION_ERROR",
        );
      const data = await desi.resolve(
        req.params.itemCode,
        value,
        req.user.username,
      );
      if (!data)
        throw new AppError(
          "Maliyet kalemi bulunamadı",
          404,
          "COST_ITEM_NOT_FOUND",
        );
      res.json({ status: "ok", data });
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
      await recalculateAllMarketplaces();
      await logged(req, "COST_ITEM_UPDATED", "cost_item", data.id, null, data);
      res.json({ status: "ok", data });
    }),
  );
  r.delete(
    "/cost-items/:id",
    asyncRoute(async (req, res) => {
      const data = await costs.deleteCostItem(req.params.id);
      if (!data) throw new AppError("Maliyet kalemi bulunamadı", 404);
      await recalculateAllMarketplaces();
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
        req.body.marketplace || "TRENDYOL",
      );
      for (const barcode of data.barcodes)
        await costEngine.recalculate(
          barcode,
          undefined,
          req.body.marketplace || "TRENDYOL",
        );
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
      for (const target of data.targets || [])
        await costEngine.recalculate(
          target.barcode,
          undefined,
          target.marketplace,
        );
      await logged(
        req,
        "MAPPINGS_BARCODE_SCOPED_REPLACE",
        "mapping",
        (data.marketplaces || ["TRENDYOL"]).join(","),
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
      for (const selectedMarketplace of [
        ...new Set(
          (req.body.rows || []).map((row) => row.marketplace || "TRENDYOL"),
        ),
      ])
        await costEngine.recalculate(undefined, undefined, selectedMarketplace);
      await logged(
        req,
        "MAPPINGS_ATOMIC_REPLACE",
        "mapping",
        [
          ...new Set(
            (req.body.rows || []).map((row) => row.marketplace || "TRENDYOL"),
          ),
        ].join(","),
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
      await costEngine.recalculate(
        req.body.barcode,
        undefined,
        req.body.marketplace || "TRENDYOL",
      );
      await logged(req, "MAPPING_UPSERTED", "mapping", data.id, null, data);
      res.status(201).json({ status: "ok", data });
    }),
  );
  r.patch(
    "/mappings/:id",
    asyncRoute(async (req, res) => {
      const data = await costs.updateMapping(req.params.id, req.body);
      if (!data) throw new AppError("Mapping bulunamadı", 404);
      await costEngine.recalculate(data.barcode, undefined, data.marketplace);
      if (data.old_barcode && data.old_barcode !== data.barcode)
        await costEngine.recalculate(
          data.old_barcode,
          undefined,
          data.marketplace,
        );
      await logged(req, "MAPPING_UPDATED", "mapping", data.id, null, data);
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/commissions/bulk",
    asyncRoute(async (req, res) => {
      throw new AppError(
        "Komisyon verisi Trendyol API'den gelir; manuel toplu giriş kapalı.",
        410,
        "COMMISSION_MANUAL_WRITE_DISABLED",
      );
    }),
  );
  r.delete(
    "/mappings/:id",
    asyncRoute(async (req, res) => {
      const data = await costs.deleteMapping(req.params.id);
      if (!data) throw new AppError("Mapping bulunamadı", 404);
      await costEngine.recalculate(data.barcode, undefined, data.marketplace);
      await logged(req, "MAPPING_DELETED", "mapping", data.id, data, null);
      res.json({ status: "ok" });
    }),
  );
  r.get(
    "/commissions",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await costs.listCommissions(req.query.marketplace || "TRENDYOL"),
      }),
    ),
  );
  r.get(
    "/commissions/missing/categories",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await costs.missingCommissionCategories(
          req.query.marketplace || "TRENDYOL",
        ),
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
      throw new AppError(
        "Komisyon verisi Trendyol API'den gelir; manuel giriş kapalı.",
        410,
        "COMMISSION_MANUAL_WRITE_DISABLED",
      );
    }),
  );
  r.patch(
    "/commissions/:categoryId",
    asyncRoute(async (req, res) => {
      throw new AppError(
        "Komisyon verisi Trendyol API'den gelir; manuel güncelleme kapalı.",
        410,
        "COMMISSION_MANUAL_WRITE_DISABLED",
      );
    }),
  );
  r.get(
    "/shipping",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: req.query.limit
          ? await costs.shippingPage({
              marketplace: req.query.marketplace || "TRENDYOL",
              page: req.query.page,
              limit: req.query.limit,
              carrier: req.query.carrier,
              desi: req.query.desi,
            })
          : await costs.shipping(req.query.marketplace || "TRENDYOL"),
      }),
    ),
  );
  r.post(
    "/shipping/hepsiburada/import",
    asyncRoute(async (req, res) => {
      const data = await shippingTariff.importHepsiburada({
        force: req.body.force === true,
      });
      await costEngine.recalculate(undefined, undefined, "HEPSIBURADA");
      await logged(
        req,
        "HEPSIBURADA_SHIPPING_IMPORTED",
        "shipping_tariff",
        "2026-07-13",
        null,
        data,
      );
      res.json({ status: "ok", data });
    }),
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
      res.json({
        status: "ok",
        data: await shippingService.coverage(
          req.query.marketplace || "TRENDYOL",
        ),
      }),
    ),
  );
  r.get(
    "/shipping/rates",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: (await costs.shipping(req.query.marketplace || "TRENDYOL"))
          .rates,
      }),
    ),
  );
  r.get(
    "/shipping/barems",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: (await costs.shipping(req.query.marketplace || "TRENDYOL"))
          .barems,
      }),
    ),
  );
  r.get(
    "/packaging-rules",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: (await costs.shipping(req.query.marketplace || "TRENDYOL"))
          .packaging,
      }),
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
      await costEngine.recalculate(undefined, undefined, data.marketplace);
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
      await costEngine.recalculate(undefined, undefined, data.marketplace);
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
      await costEngine.recalculate(undefined, undefined, data.marketplace);
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
      await costEngine.recalculate(undefined, undefined, data.marketplace);
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
      await costEngine.recalculate(undefined, undefined, data.marketplace);
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
      await costEngine.recalculate(undefined, undefined, data.marketplace);
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
      validatePackagingRule(req.body);
      const data = await costs.savePackaging(req.body);
      await costEngine.recalculate(undefined, undefined, data.marketplace);
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
      validatePackagingRule(req.body);
      const data = await costs.savePackaging(req.body, req.params.id);
      if (!data) throw new AppError("Ambalaj kuralı bulunamadı", 404);
      await costEngine.recalculate(undefined, undefined, data.marketplace);
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
      await costEngine.recalculate(undefined, undefined, data.marketplace);
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
module.exports = { costsRoutes, normalizeCostItemRows };
