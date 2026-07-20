const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FinanceService,
  calculateCashProfit,
} = require("../../src/services/finance.service");

test("500 TL siparis ornegi 98.77 TL operasyonel nakit kari verir", () => {
  assert.equal(
    calculateCashProfit({
      revenue: 500,
      commission: 95,
      shipping: 93.04,
      serviceFee: 13.19,
      productCost: 200,
    }),
    98.77,
  );
});

test("aylik ambalaj gideri nakit karindan bir kez dusulur", () => {
  assert.equal(
    calculateCashProfit({
      revenue: 500,
      commission: 95,
      shipping: 93.04,
      serviceFee: 13.19,
      productCost: 200,
      packaging: 10,
    }),
    88.77,
  );
});

test("tekrar senkronlanan siparis ilk maliyet snapshotini korur", async () => {
  let insertParams;
  const db = {
    async query(sql, params) {
      if (sql.includes("SELECT * FROM marketplace_orders"))
        return {
          rows: [
            {
              id: 8,
              product_cost_total: 200,
              shipping_total: 93.04,
              service_fee_total: 13.19,
            },
          ],
        };
      if (sql.includes("FROM products"))
        return {
          rows: [
            {
              barcode: "TEST",
              calculated_product_cost: 999,
              calculated_shipping_cost: 999,
              service_fee: 99,
              commission_rate: 19,
            },
          ],
        };
      if (sql.includes("INSERT INTO marketplace_orders")) {
        insertParams = params;
        return { rows: [{ id: 8 }] };
      }
      throw new Error(`Beklenmeyen sorgu: ${sql}`);
    },
  };
  const finance = new FinanceService({ db, trendyol: {}, hepsiburada: {} });

  await finance.upsertOrder({
    orderNumber: "ORDER-1",
    id: "PACKAGE-1",
    status: "Delivered",
    orderDate: "2026-07-20T10:00:00Z",
    lines: [
      {
        id: "LINE-1",
        barcode: "TEST",
        quantity: 1,
        amount: 500,
        commissionRate: 19,
      },
    ],
  });

  assert.equal(insertParams[7], 500);
  assert.equal(insertParams[8], 95);
  assert.equal(insertParams[9], 93.04);
  assert.equal(insertParams[10], 13.19);
  assert.equal(insertParams[11], 200);
  assert.equal(insertParams[12], 98.77);
});

test("Trendyol finans hareketlerini API limitine uygun tarih araliklarina boler", async () => {
  const ranges = [];
  const trendyol = {
    async listSettlements(options) {
      ranges.push(options);
      return { content: [], last: true };
    },
  };
  const finance = new FinanceService({ db: {}, trendyol, hepsiburada: {} });

  const result = await finance.syncFinancialTransactions({ days: 35 });

  assert.equal(ranges.length, 3);
  assert.ok(
    ranges.every(
      ({ startDate, endDate }) => endDate - startDate <= 14 * 86400000,
    ),
  );
  assert.ok(
    ranges.slice(1).every((range, index) => {
      return range.startDate === ranges[index].endDate + 1;
    }),
  );
  assert.deepEqual(result, { processed: 0, successful: 0, failed: 0 });
});

test("aylik rapor tum sonuc kolonlarini PostgreSQL uyumlu adlandirir", async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('COUNT(*) AS "order_count"'))
        return {
          rows: [
            {
              order_count: 0,
              revenue: 0,
              commission: 0,
              shipping: 0,
              service_fee: 0,
              product_cost: 0,
              operational_profit: 0,
            },
          ],
        };
      return { rows: [] };
    },
  };
  const finance = new FinanceService({ db, trendyol: {}, hepsiburada: {} });

  const report = await finance.monthlyReport("2026-07", "TRENDYOL");
  const dailyQuery = queries.find((sql) => sql.includes("TO_CHAR(order_date"));
  const hourlyQuery = queries.find((sql) => sql.includes("EXTRACT(HOUR"));
  const citiesQuery = queries.find((sql) => sql.includes("customer_city"));
  const productsQuery = queries.find((sql) =>
    sql.includes("marketplace_order_items"),
  );
  const transactionsQuery = queries.find((sql) =>
    sql.includes("marketplace_financial_transactions"),
  );

  assert.match(dailyQuery, /AS "day"/);
  assert.match(dailyQuery, /AS "orders"/);
  assert.match(hourlyQuery, /AS "hour"/);
  assert.match(citiesQuery, /AS "city"/);
  assert.match(citiesQuery, /ORDER BY "orders" DESC/);
  assert.match(productsQuery, /AS "contribution"/);
  assert.match(productsQuery, /ORDER BY "contribution" DESC/);
  assert.match(transactionsQuery, /AS "count"/);
  assert.match(transactionsQuery, /AS "amount"/);
  assert.deepEqual(report.charts.daily, []);
  assert.deepEqual(report.charts.hourly, []);
});
