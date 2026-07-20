const crypto = require("crypto");
const { roundMoney } = require("../utils/numbers");

const TRANSACTION_TYPES = [
  "Sale",
  "Return",
  "Discount",
  "DiscountCancel",
  "Coupon",
  "CouponCancel",
  "ProvisionPositive",
  "ProvisionNegative",
  "TyDiscount",
  "TyDiscountCancel",
  "TyCoupon",
  "TyCouponCancel",
  "SellerRevenuePositive",
  "SellerRevenueNegative",
  "CommissionPositive",
  "CommissionNegative",
  "DeliveryFee",
  "DeliveryFeeCancel",
];

function timestamp(value) {
  if (!value) return null;
  const date =
    typeof value === "number" || /^\d+$/.test(String(value))
      ? new Date(Number(value))
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberFrom(value, keys, fallback = 0) {
  for (const key of keys) {
    const current = value?.[key];
    const number = Number(current);
    if (Number.isFinite(number)) return number;
  }
  return fallback;
}

function moneyValue(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  if (value && typeof value === "object")
    return numberFrom(value, ["amount", "value"], fallback);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function canonicalHepsiburadaCarrier(value) {
  const original = String(value || "").trim();
  const normalized = original
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR");
  const carriers = [
    ["hepsijet xl", "hepsiJET XL"],
    ["hepsijet", "hepsiJET"],
    ["aras", "Aras Kargo"],
    ["dhl", "DHL Kargo"],
    ["kolay gelsin", "Kolay Gelsin"],
    ["ptt", "PTT Kargo"],
    ["surat", "Sürat Kargo"],
    ["yurtici", "Yurtiçi Kargo"],
    ["borusan", "Ceva Lojistik (Borusan)"],
    ["horoz", "Horoz Lojistik"],
    ["ceva", "Ceva Tedarik"],
  ];
  return carriers.find(([key]) => normalized.includes(key))?.[1] || original;
}

function calculateCashProfit({
  revenue,
  commission,
  shipping,
  serviceFee,
  productCost,
  packaging = 0,
}) {
  return roundMoney(
    Number(revenue || 0) -
      Number(commission || 0) -
      Number(shipping || 0) -
      Number(serviceFee || 0) -
      Number(productCost || 0) -
      Number(packaging || 0),
  );
}

class FinanceService {
  constructor({ db, trendyol, hepsiburada }) {
    this.db = db;
    this.trendyol = trendyol;
    this.hepsiburada = hepsiburada;
  }

  async syncOrders({ days = 35 } = {}) {
    const endDate = Date.now();
    const startDate = endDate - Math.max(Number(days) || 35, 1) * 86400000;
    let page = 0;
    let processed = 0;
    while (true) {
      const data = await this.trendyol.listOrders({
        startDate,
        endDate,
        page,
        size: 200,
      });
      const packages = data.content || data.items || [];
      for (const item of packages) {
        await this.upsertOrder(item);
        processed++;
      }
      const totalPages = Number(data.totalPages || 0);
      if (
        data.last === true ||
        packages.length === 0 ||
        (totalPages > 0 && page + 1 >= totalPages)
      )
        break;
      page++;
    }
    return { processed, successful: processed, failed: 0 };
  }

  async upsertOrder(payload) {
    const orderNumber = String(
      payload.orderNumber || payload.order_number || payload.number || "",
    ).trim();
    if (!orderNumber) return null;
    const packageId = String(
      payload.id ||
        payload.shipmentPackageId ||
        payload.packageId ||
        orderNumber,
    );
    const existingOrder = (
      await this.db.query(
        `SELECT * FROM marketplace_orders
         WHERE marketplace='TRENDYOL' AND external_order_number=$1
           AND external_package_id=$2 LIMIT 1`,
        [orderNumber, packageId],
      )
    ).rows[0];
    const lines = payload.lines || payload.items || [];
    const grossRevenue = roundMoney(
      lines.reduce(
        (sum, line) =>
          sum +
          numberFrom(line, ["amount", "lineTotal", "price"], 0) *
            (line.amount == null && line.lineTotal == null
              ? numberFrom(line, ["quantity"], 1)
              : 1),
        0,
      ),
    );
    const productRows = lines.length
      ? (
          await this.db.query(
            `SELECT barcode,calculated_product_cost,calculated_shipping_cost,
                    service_fee,commission_rate,desi
             FROM products
             WHERE marketplace='TRENDYOL' AND barcode=ANY($1::text[])`,
            [lines.map((line) => String(line.barcode || "")).filter(Boolean)],
          )
        ).rows
      : [];
    const byBarcode = new Map(productRows.map((row) => [row.barcode, row]));
    let productCostTotal = 0;
    let commissionTotal = 0;
    let serviceFeeTotal = 0;
    let shippingTotal = 0;
    for (const line of lines) {
      const product = byBarcode.get(String(line.barcode || ""));
      const quantity = numberFrom(line, ["quantity"], 1);
      const lineRevenue =
        numberFrom(line, ["amount", "lineTotal"], 0) ||
        numberFrom(line, ["price", "salePrice"], 0) * quantity;
      productCostTotal +=
        Number(product?.calculated_product_cost || 0) * quantity;
      commissionTotal +=
        lineRevenue *
        (numberFrom(
          line,
          ["commissionRate"],
          Number(product?.commission_rate || 0),
        ) /
          100);
      serviceFeeTotal += Number(product?.service_fee || 0) * quantity;
      shippingTotal = Math.max(
        shippingTotal,
        Number(product?.calculated_shipping_cost || 0),
      );
    }
    if (existingOrder) {
      productCostTotal = Number(existingOrder.product_cost_total || 0);
      serviceFeeTotal = Number(existingOrder.service_fee_total || 0);
      shippingTotal = Number(existingOrder.shipping_total || 0);
    }
    const operationalProfit = calculateCashProfit({
      revenue: grossRevenue,
      commission: commissionTotal,
      shipping: shippingTotal,
      serviceFee: serviceFeeTotal,
      productCost: productCostTotal,
    });
    const order = (
      await this.db.query(
        `INSERT INTO marketplace_orders(
           marketplace,external_order_number,external_package_id,status,
           order_date,last_modified_at,customer_city,customer_district,
           gross_revenue,commission_total,shipping_total,service_fee_total,
           product_cost_total,operational_profit,raw_data,updated_at
         )VALUES(
           'TRENDYOL',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW()
         )
         ON CONFLICT(marketplace,external_order_number,external_package_id)
         DO UPDATE SET status=EXCLUDED.status,order_date=EXCLUDED.order_date,
           last_modified_at=EXCLUDED.last_modified_at,
           customer_city=EXCLUDED.customer_city,
           customer_district=EXCLUDED.customer_district,
           gross_revenue=EXCLUDED.gross_revenue,
           commission_total=EXCLUDED.commission_total,
           shipping_total=EXCLUDED.shipping_total,
           service_fee_total=EXCLUDED.service_fee_total,
           product_cost_total=EXCLUDED.product_cost_total,
           operational_profit=EXCLUDED.operational_profit,
           raw_data=EXCLUDED.raw_data,updated_at=NOW()
         RETURNING *`,
        [
          orderNumber,
          packageId,
          payload.status || payload.packageStatus || null,
          timestamp(payload.orderDate || payload.createdDate),
          timestamp(
            payload.lastModifiedDate || payload.packageLastModifiedDate,
          ),
          payload.shipmentAddress?.city || null,
          payload.shipmentAddress?.district || null,
          grossRevenue,
          roundMoney(commissionTotal),
          roundMoney(shippingTotal),
          roundMoney(serviceFeeTotal),
          roundMoney(productCostTotal),
          operationalProfit,
          JSON.stringify(payload),
        ],
      )
    ).rows[0];
    if (existingOrder) return order;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const barcode = String(line.barcode || "");
      const product = byBarcode.get(barcode);
      const quantity = numberFrom(line, ["quantity"], 1);
      const unitPrice = numberFrom(line, ["price", "salePrice"], 0);
      const lineRevenue =
        numberFrom(line, ["amount", "lineTotal"], 0) || unitPrice * quantity;
      const commissionRate = numberFrom(
        line,
        ["commissionRate"],
        Number(product?.commission_rate || 0),
      );
      await this.db.query(
        `INSERT INTO marketplace_order_items(
           order_id,external_line_id,barcode,product_name,quantity,
           unit_sale_price,line_revenue,commission_rate,commission_amount,
           product_unit_cost,product_cost,desi,raw_data
         )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
        [
          order.id,
          String(line.id || line.lineId || `${packageId}-${index}`),
          barcode || null,
          line.productName || line.product_name || line.title || null,
          quantity,
          unitPrice,
          roundMoney(lineRevenue),
          commissionRate || null,
          roundMoney((lineRevenue * commissionRate) / 100),
          Number(product?.calculated_product_cost || 0),
          roundMoney(Number(product?.calculated_product_cost || 0) * quantity),
          product?.desi || null,
          JSON.stringify(line),
        ],
      );
    }
    return order;
  }

  async syncHepsiburadaOrders({ days = 35 } = {}) {
    if (!this.hepsiburada?.configured?.())
      throw new Error(
        "Hepsiburada Satıcı ID ve servis anahtarı yapılandırılmadı",
      );
    const end = new Date();
    const begin = new Date(
      end.getTime() - Math.max(Number(days) || 35, 1) * 86400000,
    );
    let offset = 0;
    let processed = 0;
    while (true) {
      const data = await this.hepsiburada.listOrders({
        beginDate: begin.toISOString(),
        endDate: end.toISOString(),
        offset,
        limit: 100,
      });
      const rows = Array.isArray(data)
        ? data
        : data.items || data.content || data.data || [];
      const groups = new Map();
      for (const row of rows) {
        const orderNumber = String(
          row.orderNumber || row.orderId || row.number || row.id || "",
        ).trim();
        if (!orderNumber) continue;
        const packageNumber = String(
          row.packageNumber || row.packageId || row.shipmentId || orderNumber,
        );
        const key = `${orderNumber}:${packageNumber}`;
        if (!groups.has(key))
          groups.set(key, { orderNumber, packageNumber, rows: [] });
        groups.get(key).rows.push(row);
      }
      for (const group of groups.values()) {
        await this.upsertHepsiburadaOrder(group);
        processed++;
      }
      if (rows.length < 100) break;
      offset += rows.length;
    }
    return { processed, successful: processed, failed: 0 };
  }

  async upsertHepsiburadaOrder({ orderNumber, packageNumber, rows }) {
    const existingOrder = (
      await this.db.query(
        `SELECT * FROM marketplace_orders
         WHERE marketplace='HEPSIBURADA' AND external_order_number=$1
           AND external_package_id=$2 LIMIT 1`,
        [orderNumber, packageNumber],
      )
    ).rows[0];
    const barcodes = rows
      .map((row) =>
        String(
          row.merchantSku || row.barcode || row.sku || row.hbSku || "",
        ).trim(),
      )
      .filter(Boolean);
    const products = barcodes.length
      ? (
          await this.db.query(
            `SELECT barcode,calculated_product_cost,desi,service_fee
             FROM products WHERE marketplace='HEPSIBURADA'
               AND barcode=ANY($1::text[])`,
            [barcodes],
          )
        ).rows
      : [];
    const byBarcode = new Map(products.map((row) => [row.barcode, row]));
    let grossRevenue = 0;
    let productCostTotal = 0;
    let commissionTotal = 0;
    let serviceFeeTotal = 0;
    let totalDesi = 0;
    for (const row of rows) {
      const barcode = String(
        row.merchantSku || row.barcode || row.sku || row.hbSku || "",
      ).trim();
      const product = byBarcode.get(barcode);
      const quantity = numberFrom(row, ["quantity"], 1);
      const unitPrice = moneyValue(
        row.unitPrice || row.price || row.merchantUnitPrice,
      );
      const lineRevenue =
        moneyValue(row.totalPrice || row.merchantTotalPrice) ||
        unitPrice * quantity;
      grossRevenue += lineRevenue;
      productCostTotal +=
        Number(product?.calculated_product_cost || 0) * quantity;
      commissionTotal += moneyValue(row.commission);
      serviceFeeTotal +=
        moneyValue(row.serviceFee || row.transactionFee) ||
        Number(product?.service_fee || 0) * quantity;
      totalDesi += Number(product?.desi || 0) * quantity;
    }
    const carrier = canonicalHepsiburadaCarrier(
      rows[0]?.cargoCompany ||
        rows[0]?.cargoCompanyName ||
        rows[0]?.shippingCompany ||
        "",
    );
    const shipping = carrier
      ? (
          await this.db.query(
            `SELECT cost_inc_vat,source FROM (
               SELECT cost_inc_vat,'BAREM' AS source,0 AS priority
               FROM shipping_barems
               WHERE marketplace='HEPSIBURADA' AND carrier=$1
                 AND $2::numeric BETWEEN min_basket AND max_basket
               UNION ALL
               SELECT cost_inc_vat,'DESI' AS source,1 AS priority
               FROM shipping_costs
               WHERE marketplace='HEPSIBURADA' AND carrier=$1
                 AND desi_kg=CEIL($3::numeric)
             ) selected ORDER BY priority LIMIT 1`,
            [carrier, grossRevenue, totalDesi],
          )
        ).rows[0]
      : null;
    const shippingTotal =
      moneyValue(rows[0]?.shippingFee || rows[0]?.cargoPrice) ||
      Number(shipping?.cost_inc_vat || 0);
    if (existingOrder) {
      productCostTotal = Number(existingOrder.product_cost_total || 0);
      serviceFeeTotal = Number(existingOrder.service_fee_total || 0);
    }
    const effectiveShippingTotal = existingOrder
      ? Number(existingOrder.shipping_total || 0)
      : shippingTotal;
    const operationalProfit = calculateCashProfit({
      revenue: grossRevenue,
      commission: commissionTotal,
      shipping: effectiveShippingTotal,
      serviceFee: serviceFeeTotal,
      productCost: productCostTotal,
    });
    const first = rows[0] || {};
    const order = (
      await this.db.query(
        `INSERT INTO marketplace_orders(
           marketplace,external_order_number,external_package_id,status,
           order_date,last_modified_at,customer_city,customer_district,
           gross_revenue,commission_total,shipping_total,service_fee_total,
           product_cost_total,operational_profit,raw_data,updated_at
         )VALUES(
           'HEPSIBURADA',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW()
         )
         ON CONFLICT(marketplace,external_order_number,external_package_id)
         DO UPDATE SET status=EXCLUDED.status,order_date=EXCLUDED.order_date,
           last_modified_at=EXCLUDED.last_modified_at,
           customer_city=EXCLUDED.customer_city,
           customer_district=EXCLUDED.customer_district,
           gross_revenue=EXCLUDED.gross_revenue,
           commission_total=EXCLUDED.commission_total,
           shipping_total=EXCLUDED.shipping_total,
           service_fee_total=EXCLUDED.service_fee_total,
           product_cost_total=EXCLUDED.product_cost_total,
           operational_profit=EXCLUDED.operational_profit,
           raw_data=EXCLUDED.raw_data,updated_at=NOW()
         RETURNING *`,
        [
          orderNumber,
          packageNumber,
          first.status || first.orderStatus || "PAID",
          timestamp(first.orderDate || first.createdDate),
          timestamp(first.lastModifiedDate || first.updatedDate),
          first.deliveryAddress?.city || first.shippingAddress?.city || null,
          first.deliveryAddress?.district ||
            first.shippingAddress?.district ||
            null,
          roundMoney(grossRevenue),
          roundMoney(commissionTotal),
          roundMoney(effectiveShippingTotal),
          roundMoney(serviceFeeTotal),
          roundMoney(productCostTotal),
          operationalProfit,
          JSON.stringify(rows),
        ],
      )
    ).rows[0];
    if (existingOrder) return order;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const barcode = String(
        row.merchantSku || row.barcode || row.sku || row.hbSku || "",
      ).trim();
      const product = byBarcode.get(barcode);
      const quantity = numberFrom(row, ["quantity"], 1);
      const unitPrice = moneyValue(
        row.unitPrice || row.price || row.merchantUnitPrice,
      );
      const lineRevenue =
        moneyValue(row.totalPrice || row.merchantTotalPrice) ||
        unitPrice * quantity;
      await this.db.query(
        `INSERT INTO marketplace_order_items(
           order_id,external_line_id,barcode,product_name,quantity,
           unit_sale_price,line_revenue,commission_amount,product_unit_cost,
           product_cost,desi,raw_data
         )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          order.id,
          String(row.lineItemId || row.id || `${packageNumber}-${index}`),
          barcode || null,
          row.productName || row.name || null,
          quantity,
          unitPrice,
          roundMoney(lineRevenue),
          moneyValue(row.commission),
          Number(product?.calculated_product_cost || 0),
          roundMoney(Number(product?.calculated_product_cost || 0) * quantity),
          product?.desi || null,
          JSON.stringify(row),
        ],
      );
    }
    return order;
  }

  async syncFinancialTransactions({ days = 35 } = {}) {
    const dayMs = 86400000;
    const maxRangeMs = 14 * dayMs;
    const endDate = Date.now();
    const startDate = endDate - Math.max(Number(days) || 35, 1) * dayMs;
    let processed = 0;
    for (
      let rangeStart = startDate;
      rangeStart <= endDate;
      rangeStart += maxRangeMs + 1
    ) {
      const rangeEnd = Math.min(rangeStart + maxRangeMs, endDate);
      let page = 0;
      while (true) {
        const data = await this.trendyol.listSettlements({
          startDate: rangeStart,
          endDate: rangeEnd,
          transactionTypes: TRANSACTION_TYPES,
          page,
        });
        const rows = data.content || data.items || [];
        for (const row of rows) {
          const transactionType = String(
            row.transactionType || row.transaction_type || "UNKNOWN",
          );
          const identity =
            row.id ||
            row.transactionId ||
            crypto
              .createHash("sha256")
              .update(JSON.stringify(row))
              .digest("hex");
          await this.db.query(
            `INSERT INTO marketplace_financial_transactions(
               marketplace,external_transaction_id,external_order_number,
               external_package_id,transaction_type,transaction_date,amount,
               commission_amount,seller_revenue,raw_data,updated_at
             )VALUES('TRENDYOL',$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
             ON CONFLICT(marketplace,external_transaction_id,transaction_type)
             DO UPDATE SET transaction_date=EXCLUDED.transaction_date,
               amount=EXCLUDED.amount,commission_amount=EXCLUDED.commission_amount,
               seller_revenue=EXCLUDED.seller_revenue,raw_data=EXCLUDED.raw_data,
               updated_at=NOW()`,
            [
              String(identity),
              String(row.orderNumber || row.order_number || "") || null,
              String(row.shipmentPackageId || row.packageId || "") || null,
              transactionType,
              timestamp(row.transactionDate || row.createdDate),
              numberFrom(row, ["amount", "paidPrice"], 0),
              numberFrom(row, ["commissionAmount", "commission"], 0),
              numberFrom(row, ["sellerRevenue", "sellerRevenueAmount"], 0),
              JSON.stringify(row),
            ],
          );
          processed++;
        }
        const totalPages = Number(data.totalPages || 0);
        if (
          data.last === true ||
          rows.length === 0 ||
          (totalPages > 0 && page + 1 >= totalPages)
        )
          break;
        page++;
      }
    }
    return { processed, successful: processed, failed: 0 };
  }

  async setPackagingExpense(
    month,
    amount,
    actor,
    note = "",
    marketplace = "TRENDYOL",
  ) {
    const period = `${String(month).slice(0, 7)}-01`;
    return (
      await this.db.query(
        `INSERT INTO monthly_packaging_expenses(
           marketplace,period_month,amount,note,updated_by
         )VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(marketplace,period_month)DO UPDATE SET
           amount=EXCLUDED.amount,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,
           updated_at=NOW() RETURNING *`,
        [marketplace, period, Number(amount) || 0, note, actor],
      )
    ).rows[0];
  }

  async monthlyReport(month, marketplace = "TRENDYOL") {
    const period = /^\d{4}-\d{2}$/.test(String(month))
      ? String(month)
      : new Date().toISOString().slice(0, 7);
    const start = `${period}-01`;
    const [orders, daily, hourly, cities, products, transactions, packaging] =
      await Promise.all([
        this.db.query(
          `SELECT COUNT(*) AS "order_count",
                  COALESCE(SUM(gross_revenue),0) AS "revenue",
                  COALESCE(SUM(commission_total),0) AS "commission",
                  COALESCE(SUM(shipping_total),0) AS "shipping",
                  COALESCE(SUM(service_fee_total),0) AS "service_fee",
                  COALESCE(SUM(product_cost_total),0) AS "product_cost",
                  COALESCE(SUM(operational_profit),0) AS "operational_profit"
           FROM marketplace_orders
           WHERE marketplace=$1 AND order_date>=$2::date
             AND order_date<$2::date+INTERVAL '1 month'
             AND UPPER(COALESCE(status,'')) NOT IN(
               'CANCELLED','CANCELLEDBYCUSTOMER','RETURNED','UNSUPPLIED'
             )`,
          [marketplace, start],
        ),
        this.db.query(
          `SELECT TO_CHAR(order_date AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD') AS "day",
                  COUNT(*) AS "orders",
                  ROUND(SUM(gross_revenue),2) AS "revenue",
                  ROUND(SUM(operational_profit),2) AS "profit"
           FROM marketplace_orders
           WHERE marketplace=$1 AND order_date>=$2::date
             AND order_date<$2::date+INTERVAL '1 month'
             AND UPPER(COALESCE(status,'')) NOT IN(
               'CANCELLED','CANCELLEDBYCUSTOMER','RETURNED','UNSUPPLIED'
             )
           GROUP BY 1 ORDER BY 1`,
          [marketplace, start],
        ),
        this.db.query(
          `SELECT EXTRACT(HOUR FROM order_date AT TIME ZONE 'Europe/Istanbul')::int AS "hour",
                  COUNT(*) AS "orders",
                  ROUND(SUM(gross_revenue),2) AS "revenue"
           FROM marketplace_orders
           WHERE marketplace=$1 AND order_date>=$2::date
             AND order_date<$2::date+INTERVAL '1 month'
             AND UPPER(COALESCE(status,'')) NOT IN(
               'CANCELLED','CANCELLEDBYCUSTOMER','RETURNED','UNSUPPLIED'
             )
           GROUP BY 1 ORDER BY 1`,
          [marketplace, start],
        ),
        this.db.query(
          `SELECT COALESCE(customer_city,'Bilinmiyor') AS "city",
                  COUNT(*) AS "orders",
                  ROUND(SUM(gross_revenue),2) AS "revenue"
           FROM marketplace_orders
           WHERE marketplace=$1 AND order_date>=$2::date
             AND order_date<$2::date+INTERVAL '1 month'
             AND UPPER(COALESCE(status,'')) NOT IN(
               'CANCELLED','CANCELLEDBYCUSTOMER','RETURNED','UNSUPPLIED'
             )
           GROUP BY 1 ORDER BY "orders" DESC LIMIT 12`,
          [marketplace, start],
        ),
        this.db.query(
          `SELECT oi.barcode AS "barcode",
                  MAX(oi.product_name) AS "product_name",
                  SUM(oi.quantity) AS "quantity",
                  ROUND(SUM(oi.line_revenue),2) AS "revenue",
                  ROUND(SUM(oi.line_revenue-oi.commission_amount-oi.product_cost),2) AS "contribution"
           FROM marketplace_order_items oi
           JOIN marketplace_orders o ON o.id=oi.order_id
           WHERE o.marketplace=$1 AND o.order_date>=$2::date
             AND o.order_date<$2::date+INTERVAL '1 month'
             AND UPPER(COALESCE(o.status,'')) NOT IN(
               'CANCELLED','CANCELLEDBYCUSTOMER','RETURNED','UNSUPPLIED'
             )
           GROUP BY oi.barcode ORDER BY "contribution" DESC LIMIT 20`,
          [marketplace, start],
        ),
        this.db.query(
          `SELECT transaction_type AS "transaction_type",
                  COUNT(*) AS "count",
                  ROUND(SUM(amount),2) AS "amount",
                  ROUND(SUM(commission_amount),2) AS "commission",
                  ROUND(SUM(seller_revenue),2) AS "seller_revenue"
           FROM marketplace_financial_transactions
           WHERE marketplace=$1 AND transaction_date>=$2::date
             AND transaction_date<$2::date+INTERVAL '1 month'
           GROUP BY transaction_type ORDER BY transaction_type`,
          [marketplace, start],
        ),
        this.db.query(
          `SELECT * FROM monthly_packaging_expenses
           WHERE marketplace=$1 AND period_month=$2::date LIMIT 1`,
          [marketplace, start],
        ),
      ]);
    const summary = orders.rows[0];
    const packagingAmount = Number(packaging.rows[0]?.amount || 0);
    const productCost = Number(summary.product_cost || 0);
    const profitBeforePackaging = Number(summary.operational_profit || 0);
    const profitAfterPackaging = roundMoney(
      profitBeforePackaging - packagingAmount,
    );
    const financedByBekir = roundMoney(productCost + packagingAmount);
    const transferToBekir = roundMoney(financedByBekir + profitAfterPackaging);
    const margin =
      Number(summary.revenue) > 0
        ? roundMoney((profitAfterPackaging / Number(summary.revenue)) * 100)
        : 0;
    const insights = [];
    if (margin < 5)
      insights.push({
        tone: "danger",
        title: "Net marj düşük",
        text: `Ambalaj sonrası operasyonel marj %${margin.toLocaleString("tr-TR")}.`,
      });
    if (Number(summary.shipping) > Number(summary.revenue) * 0.2)
      insights.push({
        tone: "warning",
        title: "Kargo payı yüksek",
        text: "Kargo gideri cironun %20'sini aşıyor; paket ve sepet stratejisi incelenmeli.",
      });
    if (!transactions.rows.length)
      insights.push({
        tone: "warning",
        title: "Finansal mutabakat bekleniyor",
        text: "Rapor sipariş anındaki maliyetlerle tahminidir; settlement sync çalışınca kesin kesintiler ayrıca görünür.",
      });
    return {
      period,
      marketplace,
      summary: {
        ...summary,
        packaging: packagingAmount,
        profit_before_packaging: profitBeforePackaging,
        profit_after_packaging: profitAfterPackaging,
        operational_margin: margin,
        financed_by_bekir: financedByBekir,
        transfer_to_bekir: transferToBekir,
      },
      charts: {
        daily: daily.rows,
        hourly: hourly.rows,
        cities: cities.rows,
      },
      products: products.rows,
      transactions: transactions.rows,
      packaging: packaging.rows[0] || null,
      insights,
      methodology: {
        transfer:
          "Ürün alış maliyeti + aylık ambalaj + ambalaj sonrası operasyonel kâr",
        warning:
          "Komisyon, kargo ve hizmet bedeli şirket ödemesinden zaten kesildiği için kişisel nakit çıkışına ikinci kez eklenmez.",
        vat: "Bu ekran operasyonel nakit mutabakatıdır. KDV hariç muhasebe kârı, ürün bazlı alış/satış KDV oranları ve faturalarla ayrıca doğrulanmalıdır.",
      },
    };
  }
}

module.exports = {
  FinanceService,
  TRANSACTION_TYPES,
  timestamp,
  numberFrom,
  moneyValue,
  canonicalHepsiburadaCarrier,
  calculateCashProfit,
};
