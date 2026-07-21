const crypto = require("crypto");
const { roundMoney } = require("../utils/numbers");
const { selectShippingCost } = require("../domain/pricing");

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

const DAY_MS = 86400000;
const TRENDYOL_MAX_RANGE_MS = 14 * DAY_MS;
const TRENDYOL_HISTORY_START = Date.parse("2025-12-14T21:00:00.000Z");
const HISTORICAL_CURRENT_COST_END_DATE = "2026-07-21";
const ORDER_COST_SNAPSHOT_START_DATE = "2026-07-22";

function monthInTimeZone(date = new Date(), timeZone = "Europe/Istanbul") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}`;
}

function dateInTimeZone(date = new Date(), timeZone = "Europe/Istanbul") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function lastDayOfMonth(period) {
  const [year, month] = String(period).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function normalizeDateInput(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : text;
}

function resolveReportRange(input = {}) {
  const scope = String(input.scope || "month").toLowerCase();
  if (scope === "all") {
    return {
      scope: "all",
      period: "all",
      label: "Tüm zamanlar",
      startDate: "2025-12-15",
      endDate: dateInTimeZone(),
    };
  }
  if (scope === "year") {
    const year = /^\d{4}$/.test(String(input.year || ""))
      ? String(input.year)
      : dateInTimeZone().slice(0, 4);
    return {
      scope: "year",
      period: year,
      label: `${year} yılı`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    };
  }
  if (scope === "range") {
    const startDate = normalizeDateInput(input.startDate);
    const endDate = normalizeDateInput(input.endDate);
    if (!startDate || !endDate) throw new Error("Tarih aralığı geçersiz");
    if (startDate > endDate)
      throw new Error("Başlangıç tarihi bitiş tarihinden sonra olamaz");
    return {
      scope: "range",
      period: `${startDate}:${endDate}`,
      label: `${startDate} - ${endDate}`,
      startDate,
      endDate,
    };
  }
  const period = /^\d{4}-\d{2}$/.test(String(input.month || ""))
    ? String(input.month)
    : monthInTimeZone();
  return {
    scope: "month",
    period,
    label: period,
    startDate: `${period}-01`,
    endDate: lastDayOfMonth(period),
  };
}

function dateRange({ days = 28, startDate, endDate, now = Date.now() } = {}) {
  const resolvedEnd = Number.isFinite(Number(endDate))
    ? Number(endDate)
    : Number(now);
  const resolvedStart = Number.isFinite(Number(startDate))
    ? Number(startDate)
    : resolvedEnd - Math.max(Number(days) || 28, 1) * DAY_MS;
  if (resolvedStart > resolvedEnd)
    throw new Error("Başlangıç tarihi bitiş tarihinden sonra olamaz");
  return { startDate: resolvedStart, endDate: resolvedEnd };
}

function dateWindows(startDate, endDate, maxRangeMs = TRENDYOL_MAX_RANGE_MS) {
  const windows = [];
  for (
    let rangeStart = startDate;
    rangeStart <= endDate;
    rangeStart += maxRangeMs + 1
  ) {
    windows.push({
      startDate: rangeStart,
      endDate: Math.min(rangeStart + maxRangeMs, endDate),
    });
  }
  return windows;
}

function signedSettlementAmount(row) {
  const credit = numberFrom(row, ["credit"], 0);
  const debt = numberFrom(row, ["debt"], 0);
  if (credit || debt) return roundMoney(credit - debt);
  return roundMoney(numberFrom(row, ["amount", "paidPrice"], 0));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR");
}

function isCargoInvoice(row) {
  return normalizeText(
    row?.transactionType ||
      row?.transaction_type ||
      row?.invoiceType ||
      row?.description,
  ).includes("kargo fatur");
}

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

  async syncOrders(options = {}) {
    const { startDate, endDate } = dateRange(options);
    const orderByField = options.orderByField || "PackageLastModifiedDate";
    let processed = 0;
    const windows = dateWindows(startDate, endDate);
    for (const window of windows) {
      let page = 0;
      while (true) {
        const data = await this.trendyol.listOrders({
          ...window,
          page,
          size: 200,
          orderByField,
          orderByDirection: "ASC",
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
    }
    return {
      processed,
      successful: processed,
      failed: 0,
      metadata: {
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        windows: windows.length,
        order_by: orderByField,
      },
    };
  }

  async estimateTrendyolShipping(salePrice, desi) {
    const dimensionalWeight = Number(desi || 0);
    if (dimensionalWeight <= 0)
      return { cost: 0, source: "MISSING", carrier: null };
    const settings = (
      await this.db.query(
        `SELECT key,value FROM system_settings
         WHERE key IN('default_carrier_trendyol','default_carrier')`,
      )
    ).rows;
    const values = Object.fromEntries(
      settings.map((row) => [row.key, row.value]),
    );
    const carrier = String(
      values.default_carrier_trendyol || values.default_carrier || "TEX",
    );
    const tariffs = await this.db.query(
      `SELECT 'BAREM' AS source,min_basket,max_basket,cost_inc_vat,
              NULL::numeric AS desi_kg
         FROM shipping_barems
        WHERE marketplace='TRENDYOL' AND carrier=$1
       UNION ALL
       SELECT 'DESI' AS source,NULL::numeric,NULL::numeric,cost_inc_vat,desi_kg
         FROM shipping_costs
        WHERE marketplace='TRENDYOL' AND carrier=$1`,
      [carrier],
    );
    const barems = tariffs.rows.filter((row) => row.source === "BAREM");
    const costs = tariffs.rows.filter((row) => row.source === "DESI");
    const selectedBarem = barems.find(
      (row) =>
        Number(salePrice) >= Number(row.min_basket) &&
        Number(salePrice) <= Number(row.max_basket),
    );
    const selectedRate = selectedBarem
      ? null
      : costs.find(
          (row) => Number(row.desi_kg) === Math.ceil(dimensionalWeight),
        );
    return {
      cost: selectShippingCost({
        salePrice,
        desi: dimensionalWeight,
        barems,
        costs,
        carrier,
      }),
      source: selectedBarem
        ? "MAPPED_BAREM"
        : selectedRate
          ? "MAPPED_DESI"
          : "MISSING",
      carrier,
    };
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
    let totalDesi = 0;
    let fallbackShippingTotal = 0;
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
      totalDesi += Number(product?.desi || 0) * quantity;
      fallbackShippingTotal = Math.max(
        fallbackShippingTotal,
        Number(product?.calculated_shipping_cost || 0),
      );
    }
    const shippingEstimate = await this.estimateTrendyolShipping(
      grossRevenue,
      totalDesi,
    );
    shippingTotal = Number(shippingEstimate.cost || fallbackShippingTotal || 0);
    let shippingSource = shippingEstimate.cost
      ? shippingEstimate.source
      : fallbackShippingTotal
        ? "PRODUCT_ESTIMATE"
        : "MISSING";
    if (existingOrder) {
      productCostTotal = Number(existingOrder.product_cost_total || 0);
      serviceFeeTotal = Number(existingOrder.service_fee_total || 0);
      if (existingOrder.shipping_source === "BILLED") {
        shippingTotal = Number(existingOrder.shipping_total || 0);
        totalDesi = Number(existingOrder.package_desi || totalDesi);
        shippingSource = "BILLED";
      }
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
           product_cost_total,operational_profit,raw_data,package_desi,
           shipping_source,updated_at
         )VALUES(
           'TRENDYOL',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,
           $15,$16,NOW()
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
           raw_data=EXCLUDED.raw_data,package_desi=EXCLUDED.package_desi,
           shipping_source=EXCLUDED.shipping_source,updated_at=NOW()
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
          totalDesi > 0 ? Math.ceil(totalDesi) : null,
          shippingSource,
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

  async syncFinancialTransactions(options = {}) {
    const { startDate, endDate } = dateRange(options);
    const windows = dateWindows(startDate, endDate);
    let processed = 0;
    for (const window of windows) {
      let page = 0;
      while (true) {
        const data = await this.trendyol.listSettlements({
          ...window,
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
               commission_amount,seller_revenue,raw_data,order_date,barcode,
               updated_at
             )VALUES(
               'TRENDYOL',$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,NOW()
             )
             ON CONFLICT(marketplace,external_transaction_id,transaction_type)
             DO UPDATE SET transaction_date=EXCLUDED.transaction_date,
               amount=EXCLUDED.amount,commission_amount=EXCLUDED.commission_amount,
               seller_revenue=EXCLUDED.seller_revenue,raw_data=EXCLUDED.raw_data,
               order_date=EXCLUDED.order_date,barcode=EXCLUDED.barcode,
               updated_at=NOW()`,
            [
              String(identity),
              String(row.orderNumber || row.order_number || "") || null,
              String(row.shipmentPackageId || row.packageId || "") || null,
              transactionType,
              timestamp(row.transactionDate || row.createdDate),
              signedSettlementAmount(row),
              numberFrom(row, ["commissionAmount", "commission"], 0),
              numberFrom(row, ["sellerRevenue", "sellerRevenueAmount"], 0),
              JSON.stringify(row),
              timestamp(row.orderDate),
              String(row.barcode || "") || null,
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
    return {
      processed,
      successful: processed,
      failed: 0,
      metadata: {
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        windows: windows.length,
      },
    };
  }

  async syncCargoInvoices(options = {}) {
    const { startDate, endDate } = dateRange(options);
    const windows = dateWindows(startDate, endDate);
    let invoiceCount = 0;
    let processed = 0;
    for (const window of windows) {
      let invoicePage = 0;
      while (true) {
        const data = await this.trendyol.listOtherFinancials({
          ...window,
          transactionType: "DeductionInvoices",
          page: invoicePage,
        });
        const invoices = (data.content || data.items || []).filter(
          isCargoInvoice,
        );
        for (const invoice of invoices) {
          const serial = String(
            invoice.invoiceSerialNumber ||
              invoice.id ||
              invoice.invoiceId ||
              "",
          ).trim();
          if (!serial) continue;
          invoiceCount++;
          let itemPage = 0;
          while (true) {
            const itemData = await this.trendyol.listCargoInvoiceItems(
              serial,
              itemPage,
            );
            const items = itemData.content || itemData.items || [];
            for (const item of items) {
              const parcelId = String(
                item.parcelUniqueId ||
                  item.parcelId ||
                  crypto
                    .createHash("sha256")
                    .update(JSON.stringify(item))
                    .digest("hex"),
              );
              await this.db.query(
                `INSERT INTO marketplace_cargo_charges(
                   marketplace,invoice_serial_number,invoice_date,
                   parcel_unique_id,external_order_number,
                   shipment_package_type,amount,billed_desi,raw_data,updated_at
                 )VALUES('TRENDYOL',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
                 ON CONFLICT(
                   marketplace,invoice_serial_number,parcel_unique_id,
                   shipment_package_type
                 )DO UPDATE SET invoice_date=EXCLUDED.invoice_date,
                   external_order_number=EXCLUDED.external_order_number,
                   amount=EXCLUDED.amount,billed_desi=EXCLUDED.billed_desi,
                   raw_data=EXCLUDED.raw_data,updated_at=NOW()`,
                [
                  serial,
                  timestamp(
                    invoice.transactionDate ||
                      invoice.invoiceDate ||
                      invoice.createdDate,
                  ),
                  parcelId,
                  String(item.orderNumber || item.order_number || "") || null,
                  String(
                    item.shipmentPackageType || item.packageType || "UNKNOWN",
                  ),
                  Math.abs(moneyValue(item.amount)),
                  numberFrom(item, ["desi", "deci"], 0) || null,
                  JSON.stringify(item),
                ],
              );
              processed++;
            }
            const itemPages = Number(itemData.totalPages || 0);
            if (
              itemData.last === true ||
              items.length === 0 ||
              (itemPages > 0 && itemPage + 1 >= itemPages)
            )
              break;
            itemPage++;
          }
        }
        const allInvoiceRows = data.content || data.items || [];
        const totalPages = Number(data.totalPages || 0);
        if (
          data.last === true ||
          allInvoiceRows.length === 0 ||
          (totalPages > 0 && invoicePage + 1 >= totalPages)
        )
          break;
        invoicePage++;
      }
    }
    return {
      processed,
      successful: processed,
      failed: 0,
      metadata: {
        invoices: invoiceCount,
        windows: windows.length,
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
      },
    };
  }

  async backfillTrendyolHistory({
    startDate = TRENDYOL_HISTORY_START,
    endDate = Date.now(),
  } = {}) {
    const transactions = await this.syncFinancialTransactions({
      startDate,
      endDate,
    });
    const recentStart = Math.max(startDate, endDate - 28 * DAY_MS);
    const orders = await this.syncOrders({
      startDate: recentStart,
      endDate,
      orderByField: "CreatedDate",
    });
    const cargo = await this.syncCargoInvoices({ startDate, endDate });
    const completedAt = new Date().toISOString();
    await this.db.query(
      `INSERT INTO system_settings(key,value,description,updated_by,updated_at)
       VALUES('trendyol_finance_history_backfill',$1::jsonb,
         'Trendyol finans geçmişi tamamlama durumu','system',NOW())
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,
         description=EXCLUDED.description,updated_by=EXCLUDED.updated_by,
         updated_at=NOW()`,
      [
        JSON.stringify({
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          completedAt,
          orderApiScope: "LAST_28_DAYS",
        }),
      ],
    );
    return {
      processed: transactions.processed + orders.processed + cargo.processed,
      successful:
        transactions.successful + orders.successful + cargo.successful,
      failed: transactions.failed + orders.failed + cargo.failed,
      metadata: { completed_at: completedAt, transactions, orders, cargo },
    };
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

  async monthlyShippingReport(period, marketplace = "TRENDYOL", rangeInput) {
    if (marketplace !== "TRENDYOL")
      return {
        items: [],
        total: 0,
        billed_total: 0,
        estimated_total: 0,
        order_count: 0,
        billed_orders: 0,
        estimated_orders: 0,
        missing_orders: 0,
      };
    const range = rangeInput || resolveReportRange({ month: period });
    const { startDate, endDate } = range;
    const [sales, chargeRows, settings, tariffs] = await Promise.all([
      this.db.query(
        `SELECT ft.external_order_number AS "order_number",
                MIN(ft.order_date) AS "order_date",
                ROUND(SUM(ft.amount),2) AS "sale_amount",
                CEIL(SUM(
                  COALESCE(p.desi,0) *
                  CASE
                    WHEN ft.raw_data->>'quantity' ~ '^([0-9]+)(\\.[0-9]+)?$'
                      THEN GREATEST((ft.raw_data->>'quantity')::numeric,1)
                    ELSE 1
                  END
                )) AS "estimated_desi",
                COUNT(*) AS "line_count",
                COUNT(*) FILTER(WHERE p.barcode IS NULL OR p.desi<=0)
                  AS "missing_desi_count",
                STRING_AGG(
                  DISTINCT COALESCE(p.product_name,ft.barcode,'Bilinmiyor'),
                  ' + '
                ) AS "products"
           FROM marketplace_financial_transactions ft
           LEFT JOIN products p ON p.marketplace=ft.marketplace
             AND p.barcode=ft.barcode
          WHERE ft.marketplace=$1
            AND (ft.order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
            AND (ft.order_date AT TIME ZONE 'Europe/Istanbul')
              <$3::date+INTERVAL '1 day'
            AND ft.transaction_type IN('Satış','Sale')
            AND ft.external_order_number IS NOT NULL
          GROUP BY ft.external_order_number
          ORDER BY MIN(ft.order_date) DESC`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `WITH month_orders AS(
           SELECT DISTINCT external_order_number
             FROM marketplace_financial_transactions
            WHERE marketplace=$1
              AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
              AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'
              AND transaction_type IN('Satış','Sale')
         )
         SELECT c.* FROM marketplace_cargo_charges c
         JOIN month_orders mo
           ON mo.external_order_number=c.external_order_number
         WHERE c.marketplace=$1`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT key,value FROM system_settings
         WHERE key IN('default_carrier_trendyol','default_carrier')`,
      ),
      this.db.query(
        `SELECT 'BAREM' AS source,min_basket,max_basket,cost_inc_vat,
                NULL::numeric AS desi_kg,carrier
           FROM shipping_barems WHERE marketplace='TRENDYOL'
         UNION ALL
         SELECT 'DESI' AS source,NULL::numeric,NULL::numeric,cost_inc_vat,
                desi_kg,carrier
           FROM shipping_costs WHERE marketplace='TRENDYOL'`,
      ),
    ]);
    const settingValues = Object.fromEntries(
      settings.rows.map((row) => [row.key, row.value]),
    );
    const carrier = String(
      settingValues.default_carrier_trendyol ||
        settingValues.default_carrier ||
        "TEX",
    );
    const barems = tariffs.rows.filter(
      (row) => row.source === "BAREM" && row.carrier === carrier,
    );
    const costs = tariffs.rows.filter(
      (row) => row.source === "DESI" && row.carrier === carrier,
    );
    const charges = new Map();
    for (const row of chargeRows.rows) {
      const key = String(row.external_order_number || "");
      if (!charges.has(key))
        charges.set(key, {
          amount: 0,
          desi: 0,
          invoice_date: null,
          charge_count: 0,
        });
      const current = charges.get(key);
      current.amount += Math.abs(Number(row.amount || 0));
      if (!normalizeText(row.shipment_package_type).match(/iade|return/))
        current.desi += Number(row.billed_desi || 0);
      current.invoice_date = row.invoice_date || current.invoice_date;
      current.charge_count++;
    }
    const items = sales.rows.map((row) => {
      const billed = charges.get(String(row.order_number || ""));
      const estimatedDesi = Number(row.estimated_desi || 0);
      const missingDesiCount = Number(row.missing_desi_count || 0);
      const estimatedCost = selectShippingCost({
        salePrice: Number(row.sale_amount || 0),
        desi: estimatedDesi,
        barems,
        costs,
        carrier,
      });
      const billedAmount = roundMoney(billed?.amount || 0);
      const source =
        billedAmount > 0
          ? "BILLED"
          : estimatedCost > 0 && estimatedDesi > 0 && missingDesiCount === 0
            ? "MAPPED_ESTIMATE"
            : "MISSING";
      const missingReason =
        source !== "MISSING"
          ? null
          : missingDesiCount > 0 || estimatedDesi <= 0
            ? "MAPPING_DESI_EKSIK"
            : estimatedCost <= 0
              ? "KARGO_TARIFESI_EKSIK"
              : "KARGO_FATURASI_BEKLIYOR";
      return {
        ...row,
        sale_amount: Number(row.sale_amount || 0),
        estimated_desi: estimatedDesi,
        missing_desi_count: missingDesiCount,
        billed_desi: billed?.desi || null,
        shipping_cost:
          source === "BILLED" ? billedAmount : roundMoney(estimatedCost),
        shipping_source: source,
        shipping_missing_reason: missingReason,
        carrier,
        invoice_date: billed?.invoice_date || null,
        charge_count: billed?.charge_count || 0,
      };
    });
    return {
      items,
      total: roundMoney(
        items.reduce((sum, row) => sum + Number(row.shipping_cost || 0), 0),
      ),
      billed_total: roundMoney(
        items
          .filter((row) => row.shipping_source === "BILLED")
          .reduce((sum, row) => sum + Number(row.shipping_cost || 0), 0),
      ),
      estimated_total: roundMoney(
        items
          .filter((row) => row.shipping_source === "MAPPED_ESTIMATE")
          .reduce((sum, row) => sum + Number(row.shipping_cost || 0), 0),
      ),
      order_count: items.length,
      billed_orders: items.filter((row) => row.shipping_source === "BILLED")
        .length,
      estimated_orders: items.filter(
        (row) => row.shipping_source === "MAPPED_ESTIMATE",
      ).length,
      missing_orders: items.filter((row) => row.shipping_source === "MISSING")
        .length,
    };
  }

  async historyCoverage(period, marketplace = "TRENDYOL", rangeInput) {
    const range = rangeInput || resolveReportRange({ month: period });
    const { startDate, endDate } = range;
    const [coverage, historySetting] = await Promise.all([
      this.db.query(
        `WITH financial_sales AS (
           SELECT DISTINCT external_order_number
           FROM marketplace_financial_transactions
           WHERE marketplace=$1
             AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'
             AND transaction_type IN('Satış','Sale')
         )
         SELECT
           (SELECT COUNT(DISTINCT external_order_number)
              FROM marketplace_orders
              WHERE marketplace=$1
                AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
                AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day') AS "detailed_orders",
           (SELECT COUNT(*) FROM financial_sales) AS "financial_orders",
           (SELECT COUNT(*) FROM financial_sales fs
              WHERE EXISTS(
                SELECT 1 FROM marketplace_orders mo
                WHERE mo.marketplace=$1
                  AND mo.external_order_number=fs.external_order_number
                  AND (mo.order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
                  AND (mo.order_date AT TIME ZONE 'Europe/Istanbul')
                    <$3::date+INTERVAL '1 day'
              )) AS "covered_financial_orders",
           (SELECT MIN(order_date) FROM marketplace_orders
              WHERE marketplace=$1) AS "detailed_first_date",
           (SELECT MAX(order_date) FROM marketplace_orders
              WHERE marketplace=$1) AS "detailed_last_date",
           (SELECT MIN(order_date) FROM marketplace_financial_transactions
              WHERE marketplace=$1) AS "financial_first_date",
           (SELECT MAX(order_date) FROM marketplace_financial_transactions
              WHERE marketplace=$1) AS "financial_last_date"`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT value,updated_at FROM system_settings
         WHERE key='trendyol_finance_history_backfill' LIMIT 1`,
      ),
    ]);
    const row = coverage.rows[0] || {};
    const financialOrders = Number(row.financial_orders || 0);
    const coveredFinancialOrders = Number(row.covered_financial_orders || 0);
    const detailedComplete =
      financialOrders === 0 || coveredFinancialOrders >= financialOrders;
    return {
      ...row,
      detailed_orders: Number(row.detailed_orders || 0),
      financial_orders: financialOrders,
      covered_financial_orders: coveredFinancialOrders,
      profitability_complete: detailedComplete,
      status:
        financialOrders === 0
          ? "NO_DATA"
          : detailedComplete
            ? "COMPLETE"
            : coveredFinancialOrders > 0
              ? "PARTIAL_DETAILS"
              : "FINANCIAL_ONLY",
      backfill: historySetting.rows[0]?.value || null,
      backfill_updated_at: historySetting.rows[0]?.updated_at || null,
    };
  }

  async monthlyReport(month, marketplace = "TRENDYOL") {
    const range =
      month && typeof month === "object"
        ? resolveReportRange(month)
        : resolveReportRange({ month });
    const { period, startDate, endDate } = range;
    const [
      orders,
      daily,
      hourly,
      cities,
      products,
      transactions,
      packaging,
      ledger,
      ledgerDaily,
      ledgerHourly,
      ledgerProducts,
      ledgerCosts,
      modernSnapshotCosts,
      coverage,
      shippingReport,
    ] = await Promise.all([
      this.db.query(
        `SELECT COUNT(*) AS "order_count",
                  COALESCE(SUM(gross_revenue),0) AS "revenue",
                  COALESCE(SUM(commission_total),0) AS "commission",
                  COALESCE(SUM(shipping_total),0) AS "shipping",
                  COALESCE(SUM(service_fee_total),0) AS "service_fee",
                  COALESCE(SUM(product_cost_total),0) AS "product_cost",
                  COALESCE(SUM(operational_profit),0) AS "operational_profit"
           FROM marketplace_orders
           WHERE marketplace=$1
             AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'
             AND UPPER(COALESCE(status,'')) NOT IN(
               'CANCELLED','CANCELLEDBYCUSTOMER','RETURNED','UNSUPPLIED'
             )`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT TO_CHAR(order_date AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD') AS "day",
                  COUNT(*) AS "orders",
                  ROUND(SUM(gross_revenue),2) AS "revenue",
                  ROUND(SUM(operational_profit),2) AS "profit"
           FROM marketplace_orders
           WHERE marketplace=$1
             AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'
             AND UPPER(COALESCE(status,'')) NOT IN(
               'CANCELLED','CANCELLEDBYCUSTOMER','RETURNED','UNSUPPLIED'
             )
           GROUP BY 1 ORDER BY 1`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT EXTRACT(HOUR FROM order_date AT TIME ZONE 'Europe/Istanbul')::int AS "hour",
                  COUNT(*) AS "orders",
                  ROUND(SUM(gross_revenue),2) AS "revenue"
           FROM marketplace_orders
           WHERE marketplace=$1
             AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'
             AND UPPER(COALESCE(status,'')) NOT IN(
               'CANCELLED','CANCELLEDBYCUSTOMER','RETURNED','UNSUPPLIED'
             )
           GROUP BY 1 ORDER BY 1`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT COALESCE(customer_city,'Bilinmiyor') AS "city",
                  COUNT(*) AS "orders",
                  ROUND(SUM(gross_revenue),2) AS "revenue"
           FROM marketplace_orders
           WHERE marketplace=$1
             AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'
             AND UPPER(COALESCE(status,'')) NOT IN(
               'CANCELLED','CANCELLEDBYCUSTOMER','RETURNED','UNSUPPLIED'
             )
           GROUP BY 1 ORDER BY "orders" DESC LIMIT 12`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT oi.barcode AS "barcode",
                  MAX(oi.product_name) AS "product_name",
                  SUM(oi.quantity) AS "quantity",
                  ROUND(SUM(oi.line_revenue),2) AS "revenue",
                  ROUND(SUM(oi.line_revenue-oi.commission_amount-oi.product_cost),2) AS "contribution"
           FROM marketplace_order_items oi
           JOIN marketplace_orders o ON o.id=oi.order_id
           WHERE o.marketplace=$1
             AND (o.order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (o.order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'
             AND UPPER(COALESCE(o.status,'')) NOT IN(
               'CANCELLED','CANCELLEDBYCUSTOMER','RETURNED','UNSUPPLIED'
             )
           GROUP BY oi.barcode ORDER BY "contribution" DESC LIMIT 20`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT transaction_type AS "transaction_type",
                  COUNT(*) AS "count",
                  ROUND(SUM(amount),2) AS "amount",
                  ROUND(SUM(commission_amount),2) AS "commission",
                  ROUND(SUM(seller_revenue),2) AS "seller_revenue"
           FROM marketplace_financial_transactions
           WHERE marketplace=$1
             AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'
           GROUP BY transaction_type ORDER BY transaction_type`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT $1::text AS marketplace,
                DATE_TRUNC('month',$2::date)::date AS period_month,
                COALESCE(SUM(amount),0) AS amount,
                STRING_AGG(NULLIF(note,''), ' | ') AS note
           FROM monthly_packaging_expenses
           WHERE marketplace=$1
             AND period_month>=DATE_TRUNC('month',$2::date)::date
             AND period_month<=DATE_TRUNC('month',$3::date)::date`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT
             COUNT(DISTINCT external_order_number) FILTER(
               WHERE transaction_type IN('Satış','Sale')
             ) AS "order_count",
             COUNT(*) FILTER(
               WHERE transaction_type IN('Satış','Sale')
             ) AS "sale_line_count",
             COALESCE(SUM(CASE
               WHEN transaction_type IN('Satış','Sale') THEN amount ELSE 0
             END),0) AS "gross_sales",
             COALESCE(SUM(CASE
               WHEN transaction_type IN('İade','Iade','Return') THEN amount
               ELSE 0 END),0) AS "returns",
             COALESCE(SUM(CASE
               WHEN transaction_type IN(
                 'Kupon','Coupon','İndirim','Indirim','Discount','TyDiscount',
                 'TyCoupon','Kupon İptal','CouponCancel','İndirim İptal',
                 'Indirim Iptal','DiscountCancel','TyDiscountCancel',
                 'TyCouponCancel'
               ) THEN amount ELSE 0 END),0) AS "discounts",
             COALESCE(SUM(CASE
               WHEN transaction_type IN('Satış','Sale') THEN commission_amount
               WHEN transaction_type IN('İade','Iade','Return')
                 THEN -commission_amount
               WHEN transaction_type IN(
                 'Kupon','Coupon','İndirim','Indirim','Discount','TyDiscount',
                 'TyCoupon','Kupon İptal','CouponCancel','İndirim İptal',
                 'Indirim Iptal','DiscountCancel','TyDiscountCancel',
                 'TyCouponCancel'
               ) THEN CASE WHEN amount<0 THEN -commission_amount
                           ELSE commission_amount END
               ELSE 0 END),0) AS "commission"
           FROM marketplace_financial_transactions
           WHERE marketplace=$1
             AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT
             TO_CHAR(order_date AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD') AS "day",
             COUNT(DISTINCT external_order_number) AS "orders",
             ROUND(SUM(amount),2) AS "revenue",
             NULL::numeric AS "profit"
           FROM marketplace_financial_transactions
           WHERE marketplace=$1
             AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'
             AND transaction_type IN(
               'Satış','Sale','İade','Iade','Return','Kupon','Coupon',
               'İndirim','Indirim','Discount','TyDiscount','TyCoupon',
               'Kupon İptal','CouponCancel','İndirim İptal','Indirim Iptal',
               'DiscountCancel','TyDiscountCancel','TyCouponCancel'
             )
           GROUP BY 1 ORDER BY 1`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT
             EXTRACT(HOUR FROM order_date AT TIME ZONE 'Europe/Istanbul')::int AS "hour",
             COUNT(DISTINCT external_order_number) AS "orders",
             ROUND(SUM(amount),2) AS "revenue"
           FROM marketplace_financial_transactions
           WHERE marketplace=$1
             AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'
             AND transaction_type IN('Satış','Sale')
           GROUP BY 1 ORDER BY 1`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT ft.barcode AS "barcode",MAX(p.product_name) AS "product_name",
                  NULL::numeric AS "quantity",ROUND(SUM(ft.amount),2) AS "revenue",
                  NULL::numeric AS "contribution"
           FROM marketplace_financial_transactions ft
           LEFT JOIN products p ON p.marketplace=ft.marketplace
             AND p.barcode=ft.barcode
           WHERE ft.marketplace=$1
             AND (ft.order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (ft.order_date AT TIME ZONE 'Europe/Istanbul')
              <$3::date+INTERVAL '1 day'
             AND ft.transaction_type IN(
               'Satış','Sale','İade','Iade','Return','Kupon','Coupon',
               'İndirim','Indirim','Discount','TyDiscount','TyCoupon',
               'Kupon İptal','CouponCancel','İndirim İptal','Indirim Iptal',
               'DiscountCancel','TyDiscountCancel','TyCouponCancel'
             )
           GROUP BY ft.barcode ORDER BY "revenue" DESC LIMIT 20`,
        [marketplace, startDate, endDate],
      ),
      this.db.query(
        `SELECT
             COALESCE(SUM(CASE
               WHEN ft.transaction_type IN('Satış','Sale')
                 THEN COALESCE(p.calculated_product_cost,0) *
                   CASE
                     WHEN ft.raw_data->>'quantity' ~ '^([0-9]+)(\\.[0-9]+)?$'
                       THEN GREATEST((ft.raw_data->>'quantity')::numeric,1)
                     ELSE 1
                   END
               WHEN ft.transaction_type IN('İade','Iade','Return')
                 THEN -COALESCE(p.calculated_product_cost,0) *
                   CASE
                     WHEN ft.raw_data->>'quantity' ~ '^([0-9]+)(\\.[0-9]+)?$'
                       THEN GREATEST((ft.raw_data->>'quantity')::numeric,1)
                     ELSE 1
                   END
               ELSE 0 END),0) AS "product_cost",
             COALESCE(SUM(CASE
               WHEN (ft.order_date AT TIME ZONE 'Europe/Istanbul')<=$4::date
                 AND ft.transaction_type IN('Satış','Sale')
                 THEN COALESCE(p.calculated_product_cost,0) *
                   CASE
                     WHEN ft.raw_data->>'quantity' ~ '^([0-9]+)(\\.[0-9]+)?$'
                       THEN GREATEST((ft.raw_data->>'quantity')::numeric,1)
                     ELSE 1
                   END
               WHEN (ft.order_date AT TIME ZONE 'Europe/Istanbul')<=$4::date
                 AND ft.transaction_type IN('İade','Iade','Return')
                 THEN -COALESCE(p.calculated_product_cost,0) *
                   CASE
                     WHEN ft.raw_data->>'quantity' ~ '^([0-9]+)(\\.[0-9]+)?$'
                       THEN GREATEST((ft.raw_data->>'quantity')::numeric,1)
                     ELSE 1
                   END
               ELSE 0 END),0) AS "legacy_product_cost",
             COALESCE(SUM(CASE
               WHEN ft.transaction_type IN('Satış','Sale')
                 THEN COALESCE(p.service_fee,0)
               WHEN ft.transaction_type IN('İade','Iade','Return')
                 THEN -COALESCE(p.service_fee,0)
               ELSE 0 END),0) AS "service_fee",
             COALESCE(SUM(CASE
               WHEN (ft.order_date AT TIME ZONE 'Europe/Istanbul')<=$4::date
                 AND ft.transaction_type IN('Satış','Sale')
                 THEN COALESCE(p.service_fee,0)
               WHEN (ft.order_date AT TIME ZONE 'Europe/Istanbul')<=$4::date
                 AND ft.transaction_type IN('İade','Iade','Return')
                 THEN -COALESCE(p.service_fee,0)
               ELSE 0 END),0) AS "legacy_service_fee",
             COUNT(*) FILTER(
               WHERE ft.transaction_type IN('Satış','Sale')
                 AND (p.barcode IS NULL OR p.calculated_product_cost<=0)
             ) AS "missing_cost_lines",
             COUNT(*) FILTER(
               WHERE ft.transaction_type IN('Satış','Sale')
                 AND (ft.order_date AT TIME ZONE 'Europe/Istanbul')<=$4::date
                 AND (p.barcode IS NULL OR p.calculated_product_cost<=0)
             ) AS "legacy_missing_cost_lines"
           FROM marketplace_financial_transactions ft
           LEFT JOIN products p ON p.marketplace=ft.marketplace
             AND p.barcode=ft.barcode
           WHERE ft.marketplace=$1
             AND (ft.order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (ft.order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'`,
        [marketplace, startDate, endDate, HISTORICAL_CURRENT_COST_END_DATE],
      ),
      this.db.query(
        `SELECT
             COALESCE(SUM(product_cost_total),0) AS "product_cost",
             COALESCE(SUM(service_fee_total),0) AS "service_fee"
           FROM marketplace_orders
           WHERE marketplace=$1
             AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$2::date
             AND (order_date AT TIME ZONE 'Europe/Istanbul')
               <$3::date+INTERVAL '1 day'
             AND (order_date AT TIME ZONE 'Europe/Istanbul')>=$4::date
             AND UPPER(COALESCE(status,'')) NOT IN(
               'CANCELLED','CANCELLEDBYCUSTOMER','RETURNED','UNSUPPLIED'
             )`,
        [marketplace, startDate, endDate, ORDER_COST_SNAPSHOT_START_DATE],
      ),
      this.historyCoverage(period, marketplace, range),
      this.monthlyShippingReport(period, marketplace, range),
    ]);
    const summary = orders.rows[0];
    const financial = ledger.rows[0] || {};
    const settlementGrossSales = Number(financial.gross_sales || 0);
    const costFallback = ledgerCosts.rows[0] || {};
    const settlementNetSales = roundMoney(
      settlementGrossSales +
        Number(financial.returns || 0) +
        Number(financial.discounts || 0),
    );
    const useFinancialSales = settlementGrossSales > 0;
    const salesRevenue = useFinancialSales
      ? settlementNetSales
      : Number(summary.revenue || 0);
    const commissionTotal = useFinancialSales
      ? Number(financial.commission || 0)
      : Number(summary.commission || 0);
    const shippingTotal = shippingReport.order_count
      ? Number(shippingReport.total || 0)
      : Number(summary.shipping || 0);
    const packagingAmount = Number(packaging.rows[0]?.amount || 0);
    const fallbackProductCost = roundMoney(costFallback.product_cost || 0);
    const fallbackServiceFee = roundMoney(costFallback.service_fee || 0);
    const legacyProductCost = roundMoney(
      costFallback.legacy_product_cost || 0,
    );
    const legacyServiceFee = roundMoney(costFallback.legacy_service_fee || 0);
    const snapshotProductCost = roundMoney(
      modernSnapshotCosts.rows[0]?.product_cost || 0,
    );
    const snapshotServiceFee = roundMoney(
      modernSnapshotCosts.rows[0]?.service_fee || 0,
    );
    const historicalCostPolicyApplies =
      marketplace === "TRENDYOL" &&
      useFinancialSales &&
      startDate <= HISTORICAL_CURRENT_COST_END_DATE;
    const rangeIncludesSnapshotEra = endDate >= ORDER_COST_SNAPSHOT_START_DATE;
    const useCurrentCostFallback =
      historicalCostPolicyApplies && !rangeIncludesSnapshotEra;
    const useMixedCostSource =
      historicalCostPolicyApplies && rangeIncludesSnapshotEra;
    const productCost = useMixedCostSource
      ? roundMoney(legacyProductCost + snapshotProductCost)
      : useCurrentCostFallback
        ? fallbackProductCost
        : Number(summary.product_cost || 0);
    const serviceFee = useMixedCostSource
      ? roundMoney(legacyServiceFee + snapshotServiceFee)
      : useCurrentCostFallback
        ? fallbackServiceFee
        : Number(summary.service_fee || 0);
    const costSource = useMixedCostSource
      ? "MIXED_CURRENT_AND_SNAPSHOT"
      : useCurrentCostFallback
        ? "CURRENT_PRODUCT_COST_FALLBACK"
        : coverage.profitability_complete
          ? "ORDER_SNAPSHOT"
          : "PARTIAL_ORDER_SNAPSHOT";
    const profitBeforePackaging = calculateCashProfit({
      revenue: salesRevenue,
      commission: commissionTotal,
      shipping: shippingTotal,
      serviceFee,
      productCost,
    });
    const profitAfterPackaging = roundMoney(
      profitBeforePackaging - packagingAmount,
    );
    const financedByBekir = roundMoney(productCost + packagingAmount);
    const transferToBekir = roundMoney(financedByBekir + profitAfterPackaging);
    const margin =
      salesRevenue > 0
        ? roundMoney((profitAfterPackaging / salesRevenue) * 100)
        : 0;
    const insights = [];
    if (margin < 5)
      insights.push({
        tone: "danger",
        title: "Net marj düşük",
        text: `Ambalaj sonrası operasyonel marj %${margin.toLocaleString("tr-TR")}.`,
      });
    if (shippingTotal > salesRevenue * 0.2)
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
    if (useCurrentCostFallback || useMixedCostSource)
      insights.unshift({
        tone: "info",
        title: "Geçmiş maliyet güncel mappingden hesaplandı",
        text: "15 Aralık 2025 - 21 Temmuz 2026 arasındaki siparişlerde bugünkü ürün/mapping maliyeti kullanılır; 22 Temmuz 2026 ve sonrası sipariş anındaki snapshot ile hesaplanır.",
      });
    else if (!coverage.profitability_complete)
      insights.unshift({
        tone: "warning",
        title: "Sipariş detayları kısmi",
        text: "Satış ve kesinti geçmişi finans kayıtlarından tamamlandı; ürün maliyeti ve kâr yalnızca API'den erişilebilen detaylı siparişleri kapsıyor.",
      });
    if (shippingReport.missing_orders > 0)
      insights.unshift({
        tone: "warning",
        title: "Kargo desisi eksik",
        text: `${shippingReport.missing_orders} siparişte ne kargo faturası ne de güvenilir mapping desisi bulundu.`,
      });
    return {
      period,
      range,
      marketplace,
      summary: {
        ...summary,
        sales_revenue: salesRevenue,
        commission: commissionTotal,
        shipping: shippingTotal,
        service_fee: serviceFee,
        product_cost: productCost,
        sales_order_count: useFinancialSales
          ? Number(financial.order_count || 0)
          : Number(summary.order_count || 0),
        settlement_gross_sales: settlementGrossSales,
        settlement_returns: Number(financial.returns || 0),
        settlement_discounts: Number(financial.discounts || 0),
        settlement_commission: Number(financial.commission || 0),
        sales_source: useFinancialSales ? "SETTLEMENT" : "ORDER_DETAIL",
        cost_source: costSource,
        missing_cost_lines: Number(costFallback.missing_cost_lines || 0),
        packaging: packagingAmount,
        profit_before_packaging: profitBeforePackaging,
        profit_after_packaging: profitAfterPackaging,
        operational_margin: margin,
        financed_by_bekir: financedByBekir,
        transfer_to_bekir: transferToBekir,
      },
      charts: {
        daily: useFinancialSales ? ledgerDaily.rows : daily.rows,
        hourly: useFinancialSales ? ledgerHourly.rows : hourly.rows,
        cities: cities.rows,
      },
      products: useFinancialSales ? ledgerProducts.rows : products.rows,
      transactions: transactions.rows,
      shipping: shippingReport,
      coverage,
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
  DAY_MS,
  TRENDYOL_MAX_RANGE_MS,
  TRENDYOL_HISTORY_START,
  monthInTimeZone,
  dateInTimeZone,
  resolveReportRange,
  dateRange,
  dateWindows,
  signedSettlementAmount,
  timestamp,
  numberFrom,
  moneyValue,
  canonicalHepsiburadaCarrier,
  calculateCashProfit,
};
