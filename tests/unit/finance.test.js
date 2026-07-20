const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FinanceService,
  calculateCashProfit,
  monthInTimeZone,
  signedSettlementAmount,
} = require("../../src/services/finance.service");

test("varsayilan rapor ayi Istanbul saatine gore belirlenir", () => {
  assert.equal(
    monthInTimeZone(new Date("2026-06-30T21:30:00.000Z")),
    "2026-07",
  );
});

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
  assert.equal(result.processed, 0);
  assert.equal(result.successful, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.metadata.windows, 3);
});

test("Trendyol siparislerini 14 gunluk pencerelerde ve secilen tarih alaninda ceker", async () => {
  const ranges = [];
  const trendyol = {
    async listOrders(options) {
      ranges.push(options);
      return { content: [], last: true };
    },
  };
  const finance = new FinanceService({ db: {}, trendyol, hepsiburada: {} });

  const result = await finance.syncOrders({
    days: 35,
    orderByField: "CreatedDate",
  });

  assert.equal(ranges.length, 3);
  assert.ok(
    ranges.every(
      ({ startDate, endDate }) => endDate - startDate <= 14 * 86400000,
    ),
  );
  assert.ok(ranges.every((range) => range.orderByField === "CreatedDate"));
  assert.equal(result.metadata.windows, 3);
});

test("settlement credit ve debt alanlarini imzali tutara cevirir", () => {
  assert.equal(signedSettlementAmount({ credit: 304, debt: 0 }), 304);
  assert.equal(signedSettlementAmount({ credit: 0, debt: 75.5 }), -75.5);
  assert.equal(signedSettlementAmount({ amount: 42.25 }), 42.25);
});

test("settlement senkronu barkod ve gercek siparis tarihini saklar", async () => {
  let query;
  let params;
  const db = {
    async query(nextQuery, nextParams) {
      query = nextQuery;
      params = nextParams;
      return { rows: [] };
    },
  };
  const orderDate = Date.parse("2026-06-10T12:00:00Z");
  const trendyol = {
    async listSettlements() {
      return {
        content: [
          {
            id: "TX-1",
            transactionType: "Satış",
            transactionDate: Date.parse("2026-06-20T12:00:00Z"),
            orderDate,
            orderNumber: "ORDER-1",
            shipmentPackageId: "PACKAGE-1",
            barcode: "TEST",
            credit: 500,
            commissionAmount: 95,
            sellerRevenue: 405,
          },
        ],
        last: true,
      };
    },
  };
  const finance = new FinanceService({ db, trendyol, hepsiburada: {} });

  await finance.syncFinancialTransactions({
    startDate: orderDate,
    endDate: orderDate,
  });

  assert.match(query, /order_date,barcode/);
  assert.equal(params[5], 500);
  assert.equal(params[9].getTime(), orderDate);
  assert.equal(params[10], "TEST");
});

test("gecmis tamamlama settlement gecmisini ve son 28 gun siparisini ayri ceker", async () => {
  const settingsQueries = [];
  const finance = new FinanceService({
    db: {
      async query(sql, params) {
        settingsQueries.push({ sql, params });
        return { rows: [] };
      },
    },
    trendyol: {},
    hepsiburada: {},
  });
  let transactionOptions;
  let orderOptions;
  finance.syncFinancialTransactions = async (options) => {
    transactionOptions = options;
    return { processed: 10, successful: 10, failed: 0 };
  };
  finance.syncOrders = async (options) => {
    orderOptions = options;
    return { processed: 3, successful: 3, failed: 0 };
  };
  const endDate = Date.parse("2026-07-21T12:00:00Z");
  const startDate = Date.parse("2025-12-14T21:00:00Z");

  const result = await finance.backfillTrendyolHistory({ startDate, endDate });

  assert.deepEqual(transactionOptions, { startDate, endDate });
  assert.equal(orderOptions.orderByField, "CreatedDate");
  assert.equal(orderOptions.startDate, endDate - 28 * 86400000);
  assert.equal(result.processed, 13);
  assert.match(settingsQueries[0].sql, /trendyol_finance_history_backfill/);
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
  const ledgerProductsQuery = queries.find((sql) =>
    sql.includes("MAX(p.product_name)"),
  );
  assert.ok(ledgerProductsQuery);
  assert.match(transactionsQuery, /AS "count"/);
  assert.match(transactionsQuery, /AS "amount"/);
  assert.ok(
    queries.every(
      (sql) =>
        !sql.includes("order_date") ||
        sql.includes("order_date AT TIME ZONE 'Europe/Istanbul'"),
    ),
  );
  const ledgerQuery = queries.find((sql) => sql.includes('AS "gross_sales"'));
  assert.match(ledgerQuery, /WHEN amount<0 THEN -commission_amount/);
  assert.deepEqual(report.charts.daily, []);
  assert.deepEqual(report.charts.hourly, []);
});
