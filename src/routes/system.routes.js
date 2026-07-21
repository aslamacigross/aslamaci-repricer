const express = require("express");
const { asyncRoute, AppError } = require("../utils/errors");

const OPERATIONAL_TRANSFER_CONFIRMATION = "V2_OPERASYON_VERISINI_TASI";
const OPERATIONAL_TRANSFER_TABLES = [
  "cost_items",
  "commission_rules",
  "shipping_costs",
  "shipping_barems",
  "packaging_rules",
  "file_market_items",
  "file_market_price_history",
  "cost_item_file_links",
  "mapping_suggestions",
  "mapping_suggestion_items",
  "mapping_learning_profiles",
  "mapping_feedback_events",
  "supplier_cost_sync_events",
  "shipping_tariff_imports",
  "desi_review_queue",
  "marketplace_categories",
  "marketplace_category_attributes",
  "marketplace_brands",
  "internal_category_mappings",
  "attribute_mappings",
  "brand_mappings",
  "pim_physical_products",
  "pim_recipes",
  "pim_recipe_components",
  "marketplace_listings",
  "marketplace_catalog_matches",
  "marketplace_listing_identifiers",
  "listing_barcode_pools",
  "product_publication_drafts",
  "channel_transfer_batches",
  "channel_transfer_items",
  "product_opportunities",
  "product_opportunity_events",
  "ai_content_drafts",
  "listing_content_snapshots",
  "listing_health_assessments",
  "products",
  "product_settings",
  "product_cost_mappings",
  "marketplace_orders",
  "marketplace_order_items",
  "marketplace_financial_transactions",
  "marketplace_cargo_charges",
  "monthly_packaging_expenses",
];
const OPERATIONAL_TRANSFER_TABLE_SET = new Set(OPERATIONAL_TRANSFER_TABLES);

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(String(value || "")))
    throw new AppError("Geçersiz tablo adı", 400, "INVALID_TABLE");
  return `"${value}"`;
}

async function tableColumns(db, table) {
  return (
    await db.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`,
      [table],
    )
  ).rows.map((row) => row.column_name);
}

async function tableColumnTypes(db, table) {
  const rows = (
    await db.query(
      `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`,
      [table],
    )
  ).rows;
  return new Map(
    rows.map((row) => [
      row.column_name,
      { dataType: row.data_type, udtName: row.udt_name },
    ]),
  );
}

function normalizeImportValue(value, columnType) {
  if (value == null) return value;
  if (
    columnType?.dataType === "json" ||
    columnType?.dataType === "jsonb" ||
    columnType?.udtName === "json" ||
    columnType?.udtName === "jsonb"
  ) {
    if (typeof value === "string") {
      try {
        JSON.parse(value);
        return value;
      } catch {
        return JSON.stringify(value);
      }
    }
    return JSON.stringify(value);
  }
  return value;
}

async function exportOperationalData(db) {
  const exported = {};
  const counts = {};
  for (const table of OPERATIONAL_TRANSFER_TABLES) {
    const columns = await tableColumns(db, table);
    if (!columns.length) continue;
    const rows = (
      await db.query(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY 1`)
    ).rows;
    exported[table] = { columns, rows };
    counts[table] = rows.length;
  }
  return {
    exportedAt: new Date().toISOString(),
    tables: exported,
    counts,
  };
}

async function resetSequence(db, table, columns) {
  if (!columns.includes("id")) return;
  const sequence = (
    await db.query("SELECT pg_get_serial_sequence($1,$2) AS sequence", [
      `public.${table}`,
      "id",
    ])
  ).rows[0]?.sequence;
  if (!sequence) return;
  await db.query(
    `SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(
      table,
    )}),0)+1, false)`,
    [sequence],
  );
}

async function importOperationalData(db, payload) {
  const tables = payload?.tables || {};
  const selectedTables = OPERATIONAL_TRANSFER_TABLES.filter(
    (table) => tables[table],
  );
  const skipped = Object.keys(tables).filter(
    (table) => !OPERATIONAL_TRANSFER_TABLE_SET.has(table),
  );
  if (!selectedTables.length)
    throw new AppError(
      "İçe aktarılacak operasyonel tablo yok",
      400,
      "EMPTY_OPERATIONAL_IMPORT",
    );

  await db.query("BEGIN");
  try {
    await db.query("SET CONSTRAINTS ALL DEFERRED");
    await db.query("DELETE FROM dashboard_cache");
    for (const table of [...selectedTables].reverse())
      await db.query(`DELETE FROM ${quoteIdentifier(table)}`);

    const counts = {};
    for (const table of selectedTables) {
      const availableColumns = await tableColumns(db, table);
      const availableSet = new Set(availableColumns);
      const sourceColumns = (tables[table].columns || []).filter((column) =>
        availableSet.has(column),
      );
      const rows = Array.isArray(tables[table].rows) ? tables[table].rows : [];
      if (!sourceColumns.length) {
        counts[table] = 0;
        continue;
      }
      const columnTypes = await tableColumnTypes(db, table);
      for (const [rowIndex, row] of rows.entries()) {
        const values = sourceColumns.map((column) =>
          normalizeImportValue(
            row[column] === undefined ? null : row[column],
            columnTypes.get(column),
          ),
        );
        const placeholders = sourceColumns
          .map((_, index) => `$${index + 1}`)
          .join(",");
        const columnSql = sourceColumns.map(quoteIdentifier).join(",");
        try {
          await db.query(
            `INSERT INTO ${quoteIdentifier(table)}(${columnSql})
             VALUES(${placeholders})`,
            values,
          );
        } catch (error) {
          throw new AppError(
            `Operasyonel import ${table} tablosunda takildi`,
            500,
            "OPERATIONAL_IMPORT_ROW_FAILED",
            {
              table,
              rowIndex,
              columns: sourceColumns,
              pgCode: error.code,
              pgMessage: error.message,
            },
          );
        }
      }
      await resetSequence(db, table, sourceColumns);
      counts[table] = rows.length;
    }
    await db.query("COMMIT");
    return { importedTables: selectedTables.length, counts, skipped };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

function systemRoutes({
  db,
  products,
  jobs,
  jobService,
  settings,
  audit,
  sync,
  costEngine,
  repricer,
  health,
  hepsiburada,
  marketplaceRegistry,
  dashboard,
}) {
  const r = express.Router();
  const productFilters = (query = {}) => ({
    ...query,
    active: query.active == null ? undefined : query.active === "true",
    stocked: query.stocked == null ? undefined : query.stocked === "true",
    autoUpdate:
      query.autoUpdate == null ? undefined : query.autoUpdate === "true",
  });
  r.get(
    "/buybox",
    asyncRoute(async (req, res) => {
      const marketplace = String(
        req.query.marketplace || "TRENDYOL",
      ).toUpperCase();
      const result = await products.list({
        ...productFilters(req.query),
        marketplace,
        status: req.query.status || undefined,
        limit: req.query.limit || 100,
        sort: "rank",
      });
      const previews =
        marketplace === "TRENDYOL"
          ? await repricer.preview(
              result.items.map((item) => item.barcode),
              marketplace,
            )
          : [];
      const previewByBarcode = new Map(
        previews.map((preview) => [preview.barcode, preview]),
      );
      res.json({
        status: "ok",
        ...result,
        items: result.items.map((item) => {
          const preview = previewByBarcode.get(item.barcode);
          return {
            ...item,
            preview_action: preview?.action || "KORU",
            preview_proposed_price: preview?.proposedPrice ?? item.my_price,
            preview_difference: preview?.difference ?? 0,
            preview_expected_profit: preview?.expectedProfit ?? null,
            preview_reason:
              preview?.reason ||
              (marketplace === "HEPSIBURADA"
                ? "Hepsiburada repricer bağlantısı credentials bekliyor"
                : "Fiyat korunuyor"),
            preview_blocked_reasons:
              preview?.blockedReasons ||
              (marketplace === "HEPSIBURADA"
                ? ["MARKETPLACE_CREDENTIALS_MISSING"]
                : []),
            preview_target_rank: preview?.targetRank ?? item.rank ?? null,
            preview_effective_undercut: preview?.effectiveUndercut ?? null,
          };
        }),
      });
    }),
  );
  r.post(
    "/sync/buybox",
    asyncRoute(async (req, res) => {
      const marketplace = String(
        req.body.marketplace || "TRENDYOL",
      ).toUpperCase();
      if (marketplace !== "TRENDYOL")
        throw new AppError(
          "Hepsiburada buybox bağlantısı credentials bekliyor",
          409,
          "MARKETPLACE_CREDENTIALS_MISSING",
        );
      res.json({
        status: "ok",
        data: await jobService.run("sync-buybox", { source: "web" }),
      });
    }),
  );
  r.get(
    "/jobs",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: await jobs.list() }),
    ),
  );
  r.get(
    "/jobs/runs",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: await jobs.runs(req.query.limit) }),
    ),
  );
  r.patch(
    "/jobs/:name",
    asyncRoute(async (req, res) => {
      if (
        req.body.schedule_minutes !== undefined &&
        (!Number.isFinite(Number(req.body.schedule_minutes)) ||
          Number(req.body.schedule_minutes) < 1)
      )
        throw new AppError(
          "Job sıklığı en az 1 dakika olmalı",
          400,
          "VALIDATION_ERROR",
        );
      const data = await jobs.update(req.params.name, {
        schedule_minutes:
          req.body.schedule_minutes === undefined
            ? null
            : Number(req.body.schedule_minutes),
        enabled:
          req.body.enabled === undefined ? null : Boolean(req.body.enabled),
      });
      if (!data) throw new AppError("Job bulunamadı", 404, "JOB_NOT_FOUND");
      await audit.record({
        actor: req.user.username,
        action: "JOB_SETTINGS_UPDATED",
        entityType: "job",
        entityId: req.params.name,
        after: data,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/jobs/:name/run",
    asyncRoute(async (req, res) => {
      const data = await jobService.run(req.params.name, {
        source: "web",
        actor: req.user.username,
      });
      await audit.record({
        actor: req.user.username,
        action: "JOB_MANUALLY_RUN",
        entityType: "job",
        entityId: req.params.name,
        after: data,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.get(
    "/settings",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", items: await settings.list() }),
    ),
  );
  r.patch(
    "/settings",
    asyncRoute(async (req, res) => {
      const input = { ...req.body };
      const confirmation = input.confirmation;
      delete input.confirmation;
      const current = await settings.getAll();
      const enablesLivePricing =
        (current.global_dry_run ?? true) !== false &&
        input.global_dry_run === false;
      const enablesAutomaticRepricer =
        (current.global_repricer_enabled ?? false) !== true &&
        input.global_repricer_enabled === true;
      if (
        (enablesLivePricing || enablesAutomaticRepricer) &&
        confirmation !== "CANLI_FIYAT_MODUNU_AC"
      )
        throw new AppError(
          "Canlı fiyat modu için açık güvenlik onayı gerekli",
          409,
          "LIVE_MODE_CONFIRMATION_REQUIRED",
        );
      const allowed = new Set([
        "global_dry_run",
        "global_repricer_enabled",
        "maintenance_mode",
        "default_target_profit",
        "default_price_cut_tl",
        "default_max_increase_tl",
        "global_max_price_change_pct",
        "global_max_daily_decrease_pct",
        "global_unlimited_increase",
        "default_carrier",
        "default_carrier_trendyol",
        "default_carrier_hepsiburada",
        "service_fee",
        "service_fee_trendyol",
        "service_fee_hepsiburada",
        "buybox_max_age_minutes",
        "product_sync_cron_minutes",
        "buybox_sync_cron_minutes",
        "cost_calculation_cron_minutes",
        "repricer_cron_minutes",
        "log_retention_days",
      ]);
      const numeric = new Set([
        "default_target_profit",
        "default_price_cut_tl",
        "default_max_increase_tl",
        "global_max_price_change_pct",
        "global_max_daily_decrease_pct",
        "service_fee",
        "service_fee_trendyol",
        "service_fee_hepsiburada",
        "buybox_max_age_minutes",
        "product_sync_cron_minutes",
        "buybox_sync_cron_minutes",
        "cost_calculation_cron_minutes",
        "repricer_cron_minutes",
        "log_retention_days",
      ]);
      const booleanSettings = new Set([
        "global_dry_run",
        "global_repricer_enabled",
        "maintenance_mode",
        "global_unlimited_increase",
      ]);
      const jobForSetting = {
        product_sync_cron_minutes: "sync-products",
        buybox_sync_cron_minutes: "sync-buybox",
        cost_calculation_cron_minutes: "calculate-costs",
        repricer_cron_minutes: "run-auto-repricer",
      };
      const positive = new Set([
        "buybox_max_age_minutes",
        "product_sync_cron_minutes",
        "buybox_sync_cron_minutes",
        "cost_calculation_cron_minutes",
        "repricer_cron_minutes",
        "log_retention_days",
      ]);
      const changed = [];
      const recalculateMarketplaces = new Set();
      for (const [key, value] of Object.entries(input)) {
        if (!allowed.has(key))
          throw new AppError(
            `Ayar değiştirilemez: ${key}`,
            400,
            "SETTING_NOT_ALLOWED",
          );
        if (booleanSettings.has(key) && typeof value !== "boolean")
          throw new AppError(
            `Geçersiz aç/kapat ayarı: ${key}`,
            400,
            "VALIDATION_ERROR",
          );
        if (key.startsWith("default_carrier") && !String(value || "").trim())
          throw new AppError(
            "Varsayılan kargo firması boş olamaz",
            400,
            "VALIDATION_ERROR",
          );
        if (
          numeric.has(key) &&
          (!Number.isFinite(Number(value)) ||
            Number(value) < 0 ||
            (positive.has(key) && Number(value) < 1))
        )
          throw new AppError(
            `Geçersiz sayısal ayar: ${key}`,
            400,
            "VALIDATION_ERROR",
          );
      }
      for (const [key, value] of Object.entries(input)) {
        changed.push(await settings.set(key, value, req.user.username));
        if (key === "service_fee" || key === "service_fee_trendyol") {
          await settings.applyServiceFeeToProducts(Number(value), "TRENDYOL");
          recalculateMarketplaces.add("TRENDYOL");
        }
        if (key === "service_fee_hepsiburada") {
          await settings.applyServiceFeeToProducts(
            Number(value),
            "HEPSIBURADA",
          );
          recalculateMarketplaces.add("HEPSIBURADA");
        }
        if (["default_carrier", "default_carrier_trendyol"].includes(key))
          recalculateMarketplaces.add("TRENDYOL");
        if (key === "default_carrier_hepsiburada")
          recalculateMarketplaces.add("HEPSIBURADA");
        if (jobForSetting[key])
          await jobs.update(jobForSetting[key], {
            schedule_minutes: Number(value),
            enabled: null,
          });
      }
      for (const selectedMarketplace of recalculateMarketplaces)
        await costEngine.recalculate(undefined, undefined, selectedMarketplace);
      await audit.record({
        actor: req.user.username,
        action: "SYSTEM_SETTINGS_UPDATED",
        entityType: "system_settings",
        after: input,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", items: changed });
    }),
  );
  r.get(
    "/health-report",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await health.latest(),
        items: await health.history(req.query.limit),
      }),
    ),
  );
  r.post(
    "/health-report/run",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await jobService.run("daily-system-health", {
          source: "web",
          actor: req.user.username,
        }),
      }),
    ),
  );
  r.get(
    "/integrations",
    asyncRoute(async (req, res) => {
      const items = marketplaceRegistry ? await marketplaceRegistry.list() : [];
      const byCode = Object.fromEntries(
        items.map((item) => [item.code.toLowerCase(), item]),
      );
      res.json({
        status: "ok",
        items,
        data: items.length
          ? byCode
          : {
              trendyol: await sync.health(),
              hepsiburada: {
                configured: hepsiburada?.configured?.() || false,
              },
            },
      });
    }),
  );
  r.get(
    "/integrations/:marketplace",
    asyncRoute(async (req, res) => {
      const data = await marketplaceRegistry.get(req.params.marketplace);
      if (!data)
        throw new AppError(
          "Pazaryeri bulunamadı",
          404,
          "MARKETPLACE_NOT_FOUND",
        );
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/integrations/:marketplace/test",
    asyncRoute(async (req, res) => {
      const data = await marketplaceRegistry.testConnection(
        req.params.marketplace,
      );
      await audit.record({
        actor: req.user.username,
        action: "MARKETPLACE_CONNECTION_TESTED",
        entityType: "marketplace",
        entityId: String(req.params.marketplace).toUpperCase(),
        after: { ok: data.ok, code: data.code },
        ip: req.ip,
        requestId: req.id,
      });
      res.status(data.ok ? 200 : 409).json({
        status: data.ok ? "ok" : "waiting",
        code: data.code,
        message: data.message,
        data,
      });
    }),
  );
  r.post(
    "/integrations/hepsiburada/test",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await hepsiburada.health(),
      }),
    ),
  );
  r.post(
    "/integrations/trendyol/test",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await sync.trendyol?.listProducts?.(0, 1),
      }),
    ),
  );
  r.get(
    "/integrations/trendyol/image-diagnostics",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        data: await sync.trendyol?.imageDiagnostics?.(req.query.size),
      }),
    ),
  );
  r.get(
    "/logs",
    asyncRoute(async (req, res) => {
      const [items, total] = await Promise.all([
        audit.list(req.query),
        audit.count ? audit.count(req.query) : 0,
      ]);
      res.json({ status: "ok", items, total: total || items.length });
    }),
  );
  r.get(
    "/audit-logs",
    asyncRoute(async (req, res) =>
      res.json({
        status: "ok",
        items: await audit.list({ ...req.query, type: "audit" }),
      }),
    ),
  );
  r.get(
    "/maintenance/operational-data/export",
    asyncRoute(async (req, res) => {
      if (req.query.confirmation !== OPERATIONAL_TRANSFER_CONFIRMATION)
        throw new AppError(
          "Operasyonel veri exportu için açık onay gerekli",
          409,
          "OPERATIONAL_EXPORT_CONFIRMATION_REQUIRED",
        );
      const data = await exportOperationalData(db);
      await audit.record({
        actor: req.user.username,
        action: "OPERATIONAL_DATA_EXPORTED",
        entityType: "maintenance",
        entityId: "operational-data",
        after: { counts: data.counts },
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  r.post(
    "/maintenance/operational-data/import",
    asyncRoute(async (req, res) => {
      if (req.body.confirmation !== OPERATIONAL_TRANSFER_CONFIRMATION)
        throw new AppError(
          "Operasyonel veri importu için açık onay gerekli",
          409,
          "OPERATIONAL_IMPORT_CONFIRMATION_REQUIRED",
        );
      const data = await importOperationalData(db, req.body.data);
      await costEngine.recalculate(undefined, undefined, "TRENDYOL");
      await costEngine.recalculate(undefined, undefined, "HEPSIBURADA");
      await dashboard.refresh("TRENDYOL");
      await dashboard.refresh("HEPSIBURADA");
      await audit.record({
        actor: req.user.username,
        action: "OPERATIONAL_DATA_IMPORTED",
        entityType: "maintenance",
        entityId: "operational-data",
        after: data,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({ status: "ok", data });
    }),
  );
  return r;
}
module.exports = { systemRoutes };
