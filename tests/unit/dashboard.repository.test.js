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
