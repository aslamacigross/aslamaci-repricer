const test = require("node:test");
const assert = require("node:assert/strict");
const { SyncService } = require("../../src/services/sync.service");

test("adaptive buybox dakika parametresini integer olarak sabitler", async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (calls.length === 1)
        return {
          rows: [
            {
              barcode: "8690609598109",
              has_multiple_seller: true,
              mode: "AUTOMATIC",
              setting_auto_update: true,
            },
          ],
        };
      if (calls.length === 2)
        return { rows: [{ price_states: 8, rank_states: 5 }] };
      return { rows: [] };
    },
  };
  const service = new SyncService({ db, trendyol: {}, audit: {} });
  service.buybox = async () => ({
    processed: 1,
    successful: 1,
    failed: 0,
    updatedBarcodes: ["8690609598109"],
  });

  await service.adaptiveBuybox({ limit: 1 });

  const write = calls.at(-1);
  assert.match(write.sql, /\$2::integer/);
  assert.match(write.sql, /NOW\(\)\+\(\(\$3::text\|\|' minutes'\)::interval\)/);
  assert.deepEqual(write.params, ["8690609598109", 1, "1", 100]);
});
