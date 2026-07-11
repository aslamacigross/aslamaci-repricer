const { env } = require("../config/env");
const { sleep } = require("./google-sheets.service");

class SyncService {
  constructor({ db, trendyol, audit }) {
    this.db = db;
    this.trendyol = trendyol;
    this.audit = audit;
  }

  async products() {
    let page = 0,
      processed = 0;
    while (true) {
      const data = await this.trendyol.listProducts(page, 200);
      const products = data.content || [];
      for (const product of products) {
        const barcode = String(product.barcode || "").trim();
        if (!barcode) continue;
        await this.db.query(
          `INSERT INTO products(
          marketplace,barcode,product_name,brand,category_name,category_id,my_price,list_price,stock_quantity,
          archived,locked,on_sale,approved,is_active,updated_at
        )VALUES('TRENDYOL',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,NOW())
        ON CONFLICT(marketplace,barcode)DO UPDATE SET product_name=EXCLUDED.product_name,brand=EXCLUDED.brand,
        category_name=EXCLUDED.category_name,category_id=EXCLUDED.category_id,my_price=EXCLUDED.my_price,
        list_price=EXCLUDED.list_price,stock_quantity=EXCLUDED.stock_quantity,archived=EXCLUDED.archived,
        locked=EXCLUDED.locked,on_sale=EXCLUDED.on_sale,approved=EXCLUDED.approved,is_active=TRUE,updated_at=NOW()`,
          [
            barcode,
            product.title || "",
            product.brand || "",
            product.categoryName || "",
            String(product.pimCategoryId || product.categoryId || ""),
            Number(product.salePrice) || 0,
            Number(product.listPrice) || 0,
            Number(product.quantity) || 0,
            Boolean(product.archived),
            Boolean(product.locked),
            Boolean(product.onSale),
            Boolean(product.approved),
          ],
        );
        processed++;
      }
      if (data.last === true || products.length === 0) break;
      page++;
    }
    return { processed, successful: processed, failed: 0 };
  }

  async buybox() {
    const products = (
      await this.db.query(
        `SELECT barcode,my_price FROM products WHERE marketplace='TRENDYOL' AND on_sale=TRUE ORDER BY barcode`,
      )
    ).rows;
    let processed = 0,
      failed = 0;
    for (let index = 0; index < products.length; index += 10) {
      const chunk = products.slice(index, index + 10);
      try {
        const data = await this.trendyol.buybox(
          chunk.map((row) => row.barcode),
        );
        for (const info of data.buyboxInfo || []) {
          const barcode = String(info.barcode || "");
          const original = chunk.find((row) => row.barcode === barcode);
          if (!original) continue;
          const values = [
            Number(info.buyboxPrice) || 0,
            info.secondBuyboxPrice == null
              ? null
              : Number(info.secondBuyboxPrice),
            info.thirdBuyboxPrice == null
              ? null
              : Number(info.thirdBuyboxPrice),
            info.buyboxOrder == null ? null : Number(info.buyboxOrder),
            Boolean(info.hasMultipleSeller),
            barcode,
          ];
          await this.db.query(
            `UPDATE products SET buybox_price=$1,second_price=$2,third_price=$3,rank=$4,has_multiple_seller=$5,buybox_updated_at=NOW(),updated_at=NOW() WHERE marketplace='TRENDYOL' AND barcode=$6`,
            values,
          );
          await this.db.query(
            `INSERT INTO repricer_observations(marketplace,barcode,observed_price,buybox_price,second_price,third_price,rank,has_multiple_seller)VALUES('TRENDYOL',$6,$7,$1,$2,$3,$4,$5)`,
            [...values, original.my_price],
          );
          processed++;
        }
      } catch (error) {
        failed += chunk.length;
        await this.audit.integration({
          integration: "TRENDYOL",
          level: "ERROR",
          operation: "BUYBOX_SYNC",
          message: error.message,
          details: { barcodes: chunk.map((row) => row.barcode) },
        });
      }
      if (index + 10 < products.length) await sleep(250);
    }
    return { processed, successful: processed, failed };
  }

  async health() {
    return {
      configured: this.trendyol.configured(),
      supplierIdConfigured: Boolean(env.trendyolSupplierId),
    };
  }
}

module.exports = { SyncService };
