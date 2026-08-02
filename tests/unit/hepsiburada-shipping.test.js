const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ShippingTariffService,
} = require("../../src/services/shipping-tariff.service");

test("Hepsiburada PDF tarifesi 0-4500 desi ve 11 tasiyiciyi korur", () => {
  const service = new ShippingTariffService({ db: null });
  const tariff = service.readHepsiburadaTariff();
  assert.equal(tariff.marketplace, "HEPSIBURADA");
  assert.equal(tariff.effectiveDate, "2026-07-13");
  assert.equal(tariff.vatRate, 20);
  assert.equal(tariff.carriers.length, 11);
  assert.equal(tariff.rows.length, 4501);
  assert.equal(tariff.rows[0][0], 0);
  assert.equal(tariff.rows.at(-1)[0], 4500);
  assert.equal(tariff.rows[0][3], 78.5);
  assert.equal(tariff.rows[61][3], null);
});

test("Hepsiburada kargo importu ayni desi-tasiyici satirini idempotent yazar", async () => {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (String(sql).includes("shipping_tariff_imports"))
        return { rows: [], rowCount: 0 };
      if (String(sql).includes("COUNT(*)::integer"))
        return { rows: [{ count: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const service = new ShippingTariffService({
    db: { connect: async () => client },
  });

  const result = await service.importHepsiburada({ force: true });

  assert.ok(result.processed > 0);
  const insert = queries.find(
    (query) =>
      String(query.sql).includes("INSERT INTO shipping_costs") &&
      String(query.sql).includes("ON CONFLICT(marketplace,desi_kg,carrier)"),
  );
  assert.ok(insert);
  assert.match(
    insert.sql,
    /UNNEST\(\$1::numeric\[\],\$2::text\[\],\$3::numeric\[\]\)/,
  );
  assert.equal(
    queries.filter((query) =>
      String(query.sql).includes("INSERT INTO shipping_costs"),
    ).length,
    1,
  );
  assert.equal(insert.params[0].length, result.processed);
  assert.equal(insert.params[1].length, result.processed);
  assert.equal(insert.params[2].length, result.processed);
});
