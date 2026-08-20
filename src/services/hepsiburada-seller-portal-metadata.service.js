const crypto = require("crypto");
const zlib = require("zlib");
const { AppError } = require("../utils/errors");
const { canonicalGtin } = require("../domain/catalog-gtin");

const SHEET_NAME = "Listelerim";
const SOURCE_EXPORT = "HB_SELLER_PORTAL_EXPORT";
const SOURCE_OFFICIAL = "HB_OFFICIAL_API";
const REQUIRED_HEADERS = [
  "SKU",
  "Satıcı Stok Kodu",
  "Ürün Adı",
  "Marka",
  "En Alt Kategori",
  "Barkod",
  "Durum",
];
const REPRICER_CRITICAL_COLUMNS = [
  "my_price",
  "stock_quantity",
  "commission_rate",
  "calculated_product_cost",
  "calculated_shipping_cost",
  "packaging_cost",
  "service_fee",
  "desi",
  "min_price",
  "auto_update",
  "buybox_price",
  "rank",
];

function hasText(value) {
  return String(value ?? "").trim() !== "";
}

function text(value) {
  return String(value ?? "").trim();
}

function xmlDecode(value = "") {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attr(xml, name) {
  const match = String(xml).match(
    new RegExp(`\\s${escapeRegex(name)}=(\"([^\"]*)\"|'([^']*)')`),
  );
  return xmlDecode(match?.[2] ?? match?.[3] ?? "");
}

function colIndex(cellRef) {
  const letters = String(cellRef || "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  let index = 0;
  for (const letter of letters)
    index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function readZipEntries(buffer) {
  const signature = 0x06054b50;
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset--) {
    if (buffer.readUInt32LE(offset) === signature) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0)
    throw new AppError("Geçersiz XLSX dosyası", 400, "INVALID_XLSX");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralDirOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = centralDirOffset;
  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new AppError("XLSX merkezi dizin okunamadı", 400, "INVALID_XLSX");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else
      throw new AppError(
        `Desteklenmeyen XLSX sıkıştırma yöntemi: ${method}`,
        400,
        "UNSUPPORTED_XLSX_COMPRESSION",
      );
    if (uncompressedSize && data.length !== uncompressedSize) {
      // Keep parsing; Excel files may use ZIP64-ish values in some producers.
    }
    entries.set(name, data.toString("utf8"));
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function parseSharedStrings(xml = "") {
  const values = [];
  for (const match of xml.matchAll(/<si\b[\s\S]*?<\/si>/g)) {
    const parts = [];
    for (const textMatch of match[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      parts.push(xmlDecode(textMatch[1]));
    values.push(parts.join(""));
  }
  return values;
}

function workbookSheets(entries) {
  const workbook = entries.get("xl/workbook.xml") || "";
  const rels = entries.get("xl/_rels/workbook.xml.rels") || "";
  const relById = new Map();
  for (const match of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const id = attr(match[0], "Id");
    let target = attr(match[0], "Target");
    if (target && !target.startsWith("xl/"))
      target = `xl/${target.replace(/^\/?xl\//, "")}`;
    if (id && target) relById.set(id, target);
  }
  const sheets = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*\/>/g)) {
    const name = attr(match[0], "name");
    const relId = attr(match[0], "r:id");
    const path = relById.get(relId);
    if (name && path) sheets.push({ name, path });
  }
  return sheets;
}

function parseSheetRows(xml = "", sharedStrings = []) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)) {
      const cellXml = cellMatch[0];
      const body = cellMatch[1];
      const ref = attr(cellXml, "r");
      const type = attr(cellXml, "t");
      const index = colIndex(ref);
      const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
      const inlineMatch = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
      let value = "";
      if (type === "s") value = sharedStrings[Number(valueMatch?.[1] || 0)] || "";
      else if (type === "inlineStr" && inlineMatch)
        value = [...inlineMatch[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
          .map((part) => xmlDecode(part[1]))
          .join("");
      else value = xmlDecode(valueMatch?.[1] || "");
      if (index >= 0) cells[index] = value;
    }
    rows.push(cells);
  }
  return rows;
}

function parseSellerPortalWorkbook(buffer) {
  const entries = readZipEntries(buffer);
  const sheet = workbookSheets(entries).find((item) => item.name === SHEET_NAME);
  if (!sheet)
    throw new AppError(
      "Excel içinde Listelerim sheet'i bulunamadı",
      400,
      "HB_SELLER_PORTAL_SHEET_MISSING",
    );
  const rows = parseSheetRows(
    entries.get(sheet.path) || "",
    parseSharedStrings(entries.get("xl/sharedStrings.xml") || ""),
  ).filter((row) => row.some(hasText));
  const headers = (rows.shift() || []).map(text);
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length)
    throw new AppError(
      `Eksik Excel başlığı: ${missing.join(", ")}`,
      400,
      "HB_SELLER_PORTAL_HEADERS_MISSING",
      { missing },
    );
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const records = rows.map((row) => {
    const value = (header) => text(row[headerIndex.get(header)]);
    return {
      hbSku: value("SKU"),
      merchantSku: value("Satıcı Stok Kodu"),
      productName: value("Ürün Adı"),
      brand: value("Marka"),
      categoryName: value("En Alt Kategori"),
      mainCategoryName: value("Ana Kategori"),
      rootCategoryName: value("En Temel Kategori"),
      rawBarcode: value("Barkod"),
      listingStatus: value("Durum"),
    };
  });
  return { sheetName: sheet.name, headers, records };
}

function validGtinCandidates(rawBarcode) {
  const tokens = String(rawBarcode || "")
    .split(/[^0-9]+/)
    .map((part) => canonicalGtin(part))
    .filter(Boolean);
  return [...new Set(tokens)];
}

function gtinDecision(rawBarcode) {
  const candidates = validGtinCandidates(rawBarcode);
  if (candidates.length === 1)
    return { status: "VALID", gtin: candidates[0], candidates };
  if (candidates.length > 1)
    return { status: "AMBIGUOUS_GTIN", gtin: "", candidates };
  return {
    status: hasText(rawBarcode) ? "INVALID_GTIN" : "NOT_PROVIDED",
    gtin: "",
    candidates,
  };
}

function fieldValueForSource(existing, current, sourceColumn) {
  return existing?.[sourceColumn] === SOURCE_OFFICIAL ? existing[current] : null;
}

function changedText(existingValue, incomingValue) {
  return text(existingValue) !== text(incomingValue);
}

class HepsiburadaSellerPortalMetadataService {
  constructor({ db }) {
    this.db = db;
  }

  parse(buffer) {
    return parseSellerPortalWorkbook(buffer);
  }

  async latestImport() {
    const row = (
      await this.db.query(
        `SELECT id,filename,file_sha256,imported_at,rows_total,
                rows_active_in_excel,matched,updated,summary_json
         FROM hepsiburada_seller_portal_imports
         ORDER BY imported_at DESC,id DESC
         LIMIT 1`,
      )
    ).rows[0];
    return row || null;
  }

  async readiness() {
    const latest = await this.latestImport();
    const activeMissing = (
      await this.db.query(
        `SELECT COUNT(*)::int AS count
         FROM products p
         WHERE p.marketplace='HEPSIBURADA'
           AND p.is_active=TRUE
           AND NULLIF(BTRIM(COALESCE(p.product_name,'')),'') IS NULL`,
      )
    ).rows[0]?.count;
    const activeNotInExcel = (
      await this.db.query(
        `SELECT COUNT(*)::int AS count
         FROM products p
         LEFT JOIN hepsiburada_seller_portal_metadata m
           ON m.hb_sku=p.hb_sku
         WHERE p.marketplace='HEPSIBURADA'
           AND p.is_active=TRUE
           AND m.hb_sku IS NULL`,
      )
    ).rows[0]?.count;
    const stale =
      latest?.imported_at &&
      Date.now() - new Date(latest.imported_at).getTime() >
        30 * 24 * 60 * 60 * 1000;
    return {
      latest,
      stale: Boolean(stale),
      activeMissingMetadata: Number(activeMissing || 0),
      activeNotInLatestExcel: Number(activeNotInExcel || 0),
    };
  }

  async importWorkbook(buffer, { filename = "hepsiburada-seller-portal.xlsx" } = {}) {
    const parsed = this.parse(buffer);
    return this.importRecords(parsed.records, {
      filename,
      fileSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    });
  }

  async importRecords(records, { filename = "inline", fileSha256 = "" } = {}) {
    const rows = records.filter((row) => row.hbSku);
    const activeRows = rows.filter((row) => row.listingStatus === "Satışta");
    const summary = {
      rowsTotal: rows.length,
      rowsActiveInExcel: activeRows.length,
      rowsClosedInExcel: rows.length - activeRows.length,
      uniqueHbSku: new Set(rows.map((row) => row.hbSku)).size,
      uniqueMerchantSku: new Set(rows.map((row) => row.merchantSku)).size,
      hbSkuEqualsMerchantSkuActive: activeRows.filter(
        (row) => row.hbSku === row.merchantSku,
      ).length,
      matched: 0,
      updated: 0,
      unchanged: 0,
      identityMismatch: 0,
      excelOnly: 0,
      activeNotInExcel: 0,
      validGtinAccepted: 0,
      validGtinObserved: 0,
      invalidGtin: 0,
      ambiguousGtin: 0,
      errors: 0,
      metadataMissingActiveProducts: 0,
      samples: {
        identityMismatch: [],
        excelOnly: [],
        activeNotInExcel: [],
        invalidGtin: [],
        ambiguousGtin: [],
      },
    };

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const importRow = (
        await client.query(
          `INSERT INTO hepsiburada_seller_portal_imports(
             filename,file_sha256,rows_total,rows_active_in_excel,
             rows_closed_in_excel,summary_json
           )VALUES($1,$2,$3,$4,$5,'{}'::jsonb)
           RETURNING id,imported_at`,
          [
            filename,
            fileSha256 || "inline",
            summary.rowsTotal,
            summary.rowsActiveInExcel,
            summary.rowsClosedInExcel,
          ],
        )
      ).rows[0];

      const existingProducts = (
        await client.query(
          `SELECT *
           FROM products
           WHERE marketplace='HEPSIBURADA'`,
        )
      ).rows;
      const byHbSku = new Map(
        existingProducts
          .filter((row) => hasText(row.hb_sku))
          .map((row) => [text(row.hb_sku), row]),
      );
      const excelHbSkus = new Set(rows.map((row) => row.hbSku));

      for (const row of rows) {
        const product = byHbSku.get(row.hbSku);
        const gtin = gtinDecision(row.rawBarcode);
        if (gtin.status === "VALID") summary.validGtinObserved++;
        if (gtin.status === "INVALID_GTIN") {
          summary.invalidGtin++;
          if (summary.samples.invalidGtin.length < 10)
            summary.samples.invalidGtin.push({
              hbSku: row.hbSku,
              rawBarcode: row.rawBarcode,
            });
        }
        if (gtin.status === "AMBIGUOUS_GTIN") {
          summary.ambiguousGtin++;
          if (summary.samples.ambiguousGtin.length < 10)
            summary.samples.ambiguousGtin.push({
              hbSku: row.hbSku,
              rawBarcode: row.rawBarcode,
              candidates: gtin.candidates,
            });
        }

        await client.query(
          `INSERT INTO hepsiburada_seller_portal_metadata(
             hb_sku,merchant_sku,product_name,brand,category_name,
             root_category_name,main_category_name,raw_barcode,
             catalog_gtin,catalog_gtin_status,listing_status,import_id,
             imported_at
           )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
           ON CONFLICT(hb_sku) DO UPDATE SET
             merchant_sku=EXCLUDED.merchant_sku,
             product_name=EXCLUDED.product_name,
             brand=EXCLUDED.brand,
             category_name=EXCLUDED.category_name,
             root_category_name=EXCLUDED.root_category_name,
             main_category_name=EXCLUDED.main_category_name,
             raw_barcode=EXCLUDED.raw_barcode,
             catalog_gtin=EXCLUDED.catalog_gtin,
             catalog_gtin_status=EXCLUDED.catalog_gtin_status,
             listing_status=EXCLUDED.listing_status,
             import_id=EXCLUDED.import_id,
             imported_at=NOW()`,
          [
            row.hbSku,
            row.merchantSku,
            row.productName,
            row.brand,
            row.categoryName,
            row.rootCategoryName,
            row.mainCategoryName,
            row.rawBarcode,
            gtin.gtin || null,
            gtin.status,
            row.listingStatus,
            importRow.id,
          ],
        );

        if (!product) {
          summary.excelOnly++;
          if (summary.samples.excelOnly.length < 10)
            summary.samples.excelOnly.push({
              hbSku: row.hbSku,
              merchantSku: row.merchantSku,
            });
          continue;
        }
        if (text(product.merchant_sku || product.barcode) !== row.merchantSku) {
          summary.identityMismatch++;
          if (summary.samples.identityMismatch.length < 10)
            summary.samples.identityMismatch.push({
              hbSku: row.hbSku,
              dbMerchantSku: text(product.merchant_sku || product.barcode),
              excelMerchantSku: row.merchantSku,
            });
          continue;
        }

        summary.matched++;
        const productName = fieldValueForSource(
          product,
          "product_name",
          "product_name_source",
        ) || row.productName;
        const brand =
          fieldValueForSource(product, "brand", "brand_source") || row.brand;
        const categoryName =
          fieldValueForSource(
            product,
            "category_name",
            "category_name_source",
          ) || row.categoryName;
        const productNameSource =
          product.product_name_source === SOURCE_OFFICIAL
            ? product.product_name_source
            : SOURCE_EXPORT;
        const brandSource =
          product.brand_source === SOURCE_OFFICIAL
            ? product.brand_source
            : SOURCE_EXPORT;
        const categoryNameSource =
          product.category_name_source === SOURCE_OFFICIAL
            ? product.category_name_source
            : SOURCE_EXPORT;
        const changed =
          changedText(product.product_name, productName) ||
          changedText(product.brand, brand) ||
          changedText(product.category_name, categoryName) ||
          changedText(product.product_name_source, productNameSource) ||
          changedText(product.brand_source, brandSource) ||
          changedText(product.category_name_source, categoryNameSource);
        if (changed) summary.updated++;
        else summary.unchanged++;

        await client.query(
          `UPDATE products
           SET product_name=$2,
               brand=$3,
               category_name=$4,
               product_name_source=$5,
               brand_source=$6,
               category_name_source=$7,
               metadata_refreshed_at=NOW(),
               updated_at=NOW()
           WHERE marketplace='HEPSIBURADA' AND hb_sku=$1`,
          [
            row.hbSku,
            productName,
            brand,
            categoryName,
            productNameSource,
            brandSource,
            categoryNameSource,
          ],
        );
      }

      for (const product of existingProducts) {
        if (product.is_active === true && !excelHbSkus.has(text(product.hb_sku))) {
          summary.activeNotInExcel++;
          if (summary.samples.activeNotInExcel.length < 10)
            summary.samples.activeNotInExcel.push({
              hbSku: product.hb_sku,
              merchantSku: product.merchant_sku || product.barcode,
            });
        }
      }
      summary.metadataMissingActiveProducts = Number(
        (
          await client.query(
            `SELECT COUNT(*)::int AS count
             FROM products
             WHERE marketplace='HEPSIBURADA'
               AND is_active=TRUE
               AND NULLIF(BTRIM(COALESCE(product_name,'')),'') IS NULL`,
          )
        ).rows[0]?.count || 0,
      );

      await client.query(
        `UPDATE hepsiburada_seller_portal_imports
         SET matched=$2,updated=$3,unchanged=$4,identity_mismatch=$5,
             excel_only=$6,active_not_in_excel=$7,
             valid_gtin_accepted=$8,invalid_gtin=$9,ambiguous_gtin=$10,
             errors=$11,summary_json=$12::jsonb
         WHERE id=$1`,
        [
          importRow.id,
          summary.matched,
          summary.updated,
          summary.unchanged,
          summary.identityMismatch,
          summary.excelOnly,
          summary.activeNotInExcel,
          summary.validGtinAccepted,
          summary.invalidGtin,
          summary.ambiguousGtin,
          summary.errors,
          JSON.stringify(summary),
        ],
      );
      await client.query("COMMIT");
      return { importId: importRow.id, importedAt: importRow.imported_at, ...summary };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = {
  HepsiburadaSellerPortalMetadataService,
  parseSellerPortalWorkbook,
  validGtinCandidates,
  gtinDecision,
  REQUIRED_HEADERS,
  REPRICER_CRITICAL_COLUMNS,
};
