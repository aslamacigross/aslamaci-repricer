const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DashboardRepository,
} = require("../../src/repositories/dashboard.repository");

test("dashboard date buckets use a PostgreSQL-safe day alias", async () => {
  const queries = [];
  const db = {
    query: async (sql) => {
      queries.push(sql);
      return { rows: [] };
    },
  };

  await new DashboardRepository(db).get({ fresh: true });

  const dateQueries = queries.filter((sql) => sql.includes("SELECT DATE("));
  assert.equal(dateQueries.length, 2);
  for (const sql of dateQueries) assert.match(sql, /AS "day"/);
});

test("dashboard global guvenlik ayarlarini kullaniciya tasir", async () => {
  const db = {
    query: async (sql) => {
      if (sql.includes("FROM system_settings"))
        return {
          rows: [
            { key: "global_dry_run", value: true },
            { key: "global_repricer_enabled", value: false },
            { key: "maintenance_mode", value: false },
          ],
        };
      return { rows: [] };
    },
  };

  const dashboard = await new DashboardRepository(db).get({ fresh: true });
  assert.equal(dashboard.settings.global_dry_run, true);
  assert.equal(dashboard.settings.global_repricer_enabled, false);
  assert.equal(dashboard.settings.maintenance_mode, false);
});

test("dashboard missing mapping metriği gerçek mapping kaydını da kontrol eder", async () => {
  const queries = [];
  const db = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes("SELECT key,value FROM system_settings"))
        return { rows: [] };
      if (sql.includes("COUNT(*)::int total_products"))
        return {
          rows: [
            {
              total_products: 0,
              active_products: 0,
              stocked_products: 0,
              complete_products: 0,
              missing_mapping: 0,
              cost_data_issue: 0,
              missing_commission: 0,
              missing_shipping: 0,
              loss_products: 0,
              below_minimum: 0,
              buybox_owned: 0,
              buybox_outside: 0,
              buybox_available: 0,
              stale_buybox: 0,
              auto_update_enabled: 0,
              average_margin: 0,
              actions_24h: 0,
              successful_actions_24h: 0,
              failed_actions_24h: 0,
            },
          ],
        };
      return { rows: [] };
    },
  };

  await new DashboardRepository(db).get({ fresh: true });

  const kpiSql = queries.find((sql) =>
    sql.includes("COUNT(*)::int total_products"),
  );
  assert.match(
    kpiSql,
    /is_active=TRUE AND stock_quantity>0 AND \(data_status='MAPPING_MISSING'/,
  );
  assert.match(kpiSql, /NOT EXISTS\(\s*SELECT 1 FROM product_cost_mappings/);
});

test("dashboard maliyet aksiyon metrikleri pasif ve stoksuz ürünleri saymaz", async () => {
  const queries = [];
  const db = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes("SELECT key,value FROM system_settings"))
        return { rows: [] };
      if (sql.includes("COUNT(*)::int total_products"))
        return {
          rows: [
            {
              total_products: 0,
              active_products: 0,
              stocked_products: 0,
              complete_products: 0,
              missing_mapping: 0,
              cost_data_issue: 0,
              missing_commission: 0,
              missing_shipping: 0,
              loss_products: 0,
              below_minimum: 0,
              buybox_owned: 0,
              buybox_outside: 0,
              buybox_available: 0,
              stale_buybox: 0,
              auto_update_enabled: 0,
              average_margin: 0,
              actions_24h: 0,
              successful_actions_24h: 0,
              failed_actions_24h: 0,
            },
          ],
        };
      return { rows: [] };
    },
  };

  await new DashboardRepository(db).get({ fresh: true });

  const kpiSql = queries.find((sql) =>
    sql.includes("COUNT(*)::int total_products"),
  );
  assert.match(
    kpiSql,
    /is_active=TRUE AND stock_quantity>0 AND needs_cost_mapping/,
  );
  assert.match(
    kpiSql,
    /is_active=TRUE AND stock_quantity>0 AND calculated_net_profit<0/,
  );
  assert.match(
    kpiSql,
    /is_active=TRUE AND stock_quantity>0 AND min_price>0 AND my_price<min_price/,
  );
  assert.match(kpiSql, /is_active=TRUE AND stock_quantity>0 AND auto_update/);
});

test("dashboard buybox metrikleri sadece satılabilir ürünleri sayar", async () => {
  const queries = [];
  const db = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes("SELECT key,value FROM system_settings"))
        return { rows: [] };
      if (sql.includes("COUNT(*)::int total_products"))
        return {
          rows: [
            {
              total_products: 0,
              active_products: 0,
              stocked_products: 0,
              complete_products: 0,
              missing_mapping: 0,
              cost_data_issue: 0,
              missing_commission: 0,
              missing_shipping: 0,
              loss_products: 0,
              below_minimum: 0,
              buybox_owned: 0,
              buybox_outside: 0,
              buybox_available: 0,
              stale_buybox: 0,
              auto_update_enabled: 0,
              average_margin: 0,
              actions_24h: 0,
              successful_actions_24h: 0,
              failed_actions_24h: 0,
            },
          ],
        };
      return { rows: [] };
    },
  };

  await new DashboardRepository(db).get({ fresh: true });

  const kpiSql = queries.find((sql) =>
    sql.includes("COUNT(*)::int total_products"),
  );
  assert.match(kpiSql, /is_active=TRUE AND stock_quantity>0 AND rank=1/);
  assert.match(
    kpiSql,
    /is_active=TRUE AND stock_quantity>0 AND \(buybox_updated_at IS NULL/,
  );
});

test("dashboard metrik detayları mapping kırılımı alanlarını döndürür", async () => {
  let detailSql = "";
  const db = {
    query: async (sql) => {
      detailSql = sql;
      return { rows: [] };
    },
  };

  await new DashboardRepository(db).metricDetails("missing_mapping");

  assert.match(detailSql, /mapping_count/);
  assert.match(detailSql, /p\.is_active=TRUE AND p\.stock_quantity>0/);
  assert.match(detailSql, /calculated_product_cost/);
  assert.match(detailSql, /data_issue_label/);
});

test("dashboard eski buybox detayı pasif ve stoksuz ürünleri dışarıda bırakır", async () => {
  let detailSql = "";
  const db = {
    query: async (sql) => {
      detailSql = sql;
      return { rows: [] };
    },
  };

  await new DashboardRepository(db).metricDetails("stale_buybox");

  assert.match(detailSql, /p\.is_active=TRUE AND p\.stock_quantity>0/);
  assert.match(detailSql, /p\.buybox_updated_at IS NULL/);
});

test("dashboard zarar ve minimum fiyat detayları pasif ürünleri dışarıda bırakır", async () => {
  const detailQueries = [];
  const db = {
    query: async (sql) => {
      detailQueries.push(sql);
      return { rows: [] };
    },
  };

  const repository = new DashboardRepository(db);
  await repository.metricDetails("loss_products");
  await repository.metricDetails("below_minimum");

  assert.match(
    detailQueries[0],
    /p\.is_active=TRUE AND p\.stock_quantity>0 AND p\.calculated_net_profit<0/,
  );
  assert.match(
    detailQueries[1],
    /p\.is_active=TRUE AND p\.stock_quantity>0 AND p\.min_price>0 AND p\.my_price<p\.min_price/,
  );
});
