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
