const { env } = require("../config/env");
const { sleep } = require("./google-sheets.service");
const { roundMoney } = require("../utils/numbers");

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
      const data = await this.trendyol.listProducts(page, 100);
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

  async buybox(barcodes) {
    const requested = Array.isArray(barcodes)
      ? [...new Set(barcodes.map((value) => String(value)).filter(Boolean))]
      : null;
    if (requested && !requested.length)
      return {
        processed: 0,
        successful: 0,
        failed: 0,
        updatedBarcodes: [],
        failedBarcodes: [],
      };
    const products = (
      await this.db.query(
        `SELECT barcode,my_price,product_name,min_price,calculated_net_profit
         FROM products WHERE marketplace='TRENDYOL' AND on_sale=TRUE
           ${requested ? "AND barcode=ANY($1::text[])" : ""}
         ORDER BY barcode`,
        requested ? [requested] : [],
      )
    ).rows;
    let processed = 0,
      failed = 0;
    const updatedBarcodes = [];
    const failedBarcodes = [];
    for (let index = 0; index < products.length; index += 10) {
      const chunk = products.slice(index, index + 10);
      try {
        const data = await this.trendyol.buybox(
          chunk.map((row) => row.barcode),
        );
        const responded = new Set();
        for (const info of data.buyboxInfo || []) {
          const barcode = String(info.barcode || "");
          const original = chunk.find((row) => row.barcode === barcode);
          if (!original) continue;
          responded.add(barcode);
          const observedAt = new Date();
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
            observedAt,
          ];
          await this.db.query(
            `UPDATE products SET buybox_price=$1,second_price=$2,third_price=$3,
             rank=$4,has_multiple_seller=$5,buybox_updated_at=$7,updated_at=NOW()
             WHERE marketplace='TRENDYOL' AND barcode=$6`,
            values,
          );
          await this.db.query(
            `INSERT INTO repricer_observations(
              marketplace,barcode,observed_price,buybox_price,second_price,
              third_price,rank,has_multiple_seller,observed_at
            )VALUES('TRENDYOL',$6,$8,$1,$2,$3,$4,$5,$7)`,
            [...values, original.my_price],
          );
          await this.db.query(
            `INSERT INTO buybox_history(
              marketplace,barcode,product_name,observed_price,buybox_price,
              second_price,third_price,rank,has_multiple_seller,min_price,
              net_profit,observed_at
            )VALUES('TRENDYOL',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT(marketplace,barcode,observed_at)DO NOTHING`,
            [
              barcode,
              original.product_name,
              original.my_price,
              values[0],
              values[1],
              values[2],
              values[3],
              values[4],
              original.min_price,
              original.calculated_net_profit,
              observedAt,
            ],
          );
          const visiblePrices = [values[0], values[1], values[2]];
          for (let rank = 1; rank <= visiblePrices.length; rank++) {
            if (!(visiblePrices[rank - 1] > 0)) continue;
            await this.db.query(
              `INSERT INTO competitor_price_observations(
                marketplace,barcode,rank,price,observed_at
              )VALUES('TRENDYOL',$1,$2,$3,$4)`,
              [barcode, rank, visiblePrices[rank - 1], observedAt],
            );
          }
          processed++;
          updatedBarcodes.push(barcode);
        }
        for (const item of chunk)
          if (!responded.has(item.barcode)) {
            failed++;
            failedBarcodes.push(item.barcode);
          }
      } catch (error) {
        failed += chunk.length;
        failedBarcodes.push(...chunk.map((row) => row.barcode));
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
    return {
      processed,
      successful: processed,
      failed,
      updatedBarcodes,
      failedBarcodes: [...new Set(failedBarcodes)],
    };
  }

  async verifyPriceAction(action) {
    const batchResponse = await this.trendyol.getBatchResult(action.batch_id);
    const item = (batchResponse.items || []).find((candidate) => {
      const request = candidate.requestItem || candidate.request || {};
      return String(request.barcode || "") === String(action.barcode);
    });
    const itemStatus = String(item?.status || "IN_PROGRESS").toUpperCase();
    if (itemStatus === "FAILED")
      return {
        status: "FAILED",
        error: (item.failureReasons || ["Trendyol batch işlemi başarısız"])
          .map((reason) =>
            typeof reason === "string"
              ? reason
              : reason.message || JSON.stringify(reason),
          )
          .join("; "),
        batchResponse,
      };
    if (itemStatus !== "SUCCESS") return { status: "PENDING", batchResponse };

    const marketProduct = await this.trendyol.getProductByBarcode(
      action.barcode,
    );
    if (!marketProduct)
      return {
        status: "PENDING",
        error: "Trendyol ürün fiyatı henüz okunamadı",
        batchResponse,
      };
    const observedPrice = roundMoney(marketProduct.salePrice);
    if (observedPrice !== roundMoney(action.proposed_price))
      return {
        status: "MISMATCH",
        error: `Beklenen fiyat ${roundMoney(action.proposed_price)}, görülen fiyat ${observedPrice}`,
        batchResponse,
        marketProduct,
      };
    return {
      status: "VERIFIED",
      batchResponse,
      marketProduct,
      observedPrice,
    };
  }

  async health() {
    return {
      configured: this.trendyol.configured(),
      supplierIdConfigured: Boolean(env.trendyolSupplierId),
    };
  }
}

module.exports = { SyncService };
