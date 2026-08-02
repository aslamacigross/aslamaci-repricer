const { env } = require("../config/env");
const { roundMoney } = require("../utils/numbers");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function firstValue(source, keys, fallback = "") {
  for (const key of keys) {
    const value = key
      .split(".")
      .reduce((object, part) => object?.[part], source);
    if (value !== undefined && value !== null && String(value).trim() !== "")
      return value;
  }
  return fallback;
}

function hepsiburadaListingBarcode(listing) {
  return String(
    firstValue(listing, [
      "merchantSku",
      "merchantSKU",
      "sku",
      "barcode",
      "merchantBarcode",
      "hbSku",
      "productBarcode",
    ]),
  ).trim();
}

function hepsiburadaListingPlatformId(listing) {
  return String(
    firstValue(listing, [
      "hbSku",
      "hepsiburadaSku",
      "productId",
      "listingId",
      "variantGroupId",
    ]),
  ).trim();
}

function hepsiburadaCatalogBarcode(product) {
  return String(
    firstValue(product, [
      "merchantSku",
      "merchantSKU",
      "sku",
      "barcode",
      "merchantBarcode",
    ]),
  ).trim();
}

function hepsiburadaCatalogPlatformId(product) {
  return String(
    firstValue(product, [
      "hbSku",
      "hepsiburadaSku",
      "productId",
      "variantGroupId",
    ]),
  ).trim();
}

function normalizedKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function addMetadataIndex(index, product) {
  for (const key of [
    product?.merchantSku,
    product?.merchantSKU,
    product?.sku,
    product?.barcode,
    product?.hbSku,
    product?.hepsiburadaSku,
    product?.productId,
    product?.listingId,
    product?.variantGroupId,
  ]) {
    const normalized = normalizedKey(key);
    if (normalized && !index.has(normalized)) index.set(normalized, product);
  }
}

function metadataForListing(index, listing) {
  return (
    index.get(normalizedKey(hepsiburadaListingBarcode(listing))) ||
    index.get(normalizedKey(hepsiburadaListingPlatformId(listing))) ||
    index.get(normalizedKey(listing?.productId)) ||
    null
  );
}

function listingForMetadata(index, product) {
  return (
    index.get(normalizedKey(hepsiburadaCatalogBarcode(product))) ||
    index.get(normalizedKey(hepsiburadaCatalogPlatformId(product))) ||
    index.get(normalizedKey(product?.productId)) ||
    null
  );
}

function hepsiburadaListingPrice(listing) {
  const value = firstValue(listing, [
    "price",
    "salePrice",
    "unitPrice",
    "merchantUnitPrice",
    "listingPrice",
    "price.amount",
    "price.value",
  ]);
  return Number(value) || 0;
}

function hepsiburadaListingStock(listing) {
  const value = firstValue(listing, [
    "availableStock",
    "stock",
    "quantity",
    "availableQuantity",
    "inventory",
  ]);
  return Number(value) || 0;
}

function hepsiburadaListingBuybox(listing) {
  const buyboxPrice = Number(
    firstValue(listing, [
      "buyboxPrice",
      "buyBoxPrice",
      "bestPrice",
      "winningPrice",
      "buybox.price",
      "buyBox.price",
    ]),
  );
  const secondPrice = Number(
    firstValue(listing, ["secondPrice", "secondBuyboxPrice", "rank2Price"]),
  );
  const thirdPrice = Number(
    firstValue(listing, ["thirdPrice", "thirdBuyboxPrice", "rank3Price"]),
  );
  const rank = Number(
    firstValue(listing, [
      "rank",
      "buyboxOrder",
      "buyBoxOrder",
      "buyboxRank",
      "buyBoxRank",
    ]),
  );
  const sellerCount = Number(
    firstValue(listing, ["sellerCount", "merchantCount", "competitorCount"]),
  );
  return {
    buyboxPrice:
      Number.isFinite(buyboxPrice) && buyboxPrice > 0 ? buyboxPrice : null,
    secondPrice:
      Number.isFinite(secondPrice) && secondPrice > 0 ? secondPrice : null,
    thirdPrice:
      Number.isFinite(thirdPrice) && thirdPrice > 0 ? thirdPrice : null,
    rank: Number.isFinite(rank) && rank > 0 ? rank : null,
    hasMultipleSeller: Number.isFinite(sellerCount) ? sellerCount > 1 : null,
  };
}

function enrichedListingValue(
  listing,
  fallback,
  keys,
  fallbackKey,
  empty = "",
) {
  const listingValue = firstValue(listing, keys, null);
  if (listingValue !== null) return listingValue;
  return firstValue(fallback, [...keys, fallbackKey], empty);
}

function normalizeImageUrl(value) {
  if (!value) return null;
  const raw =
    typeof value === "string"
      ? value
      : value.url ||
        value.imageUrl ||
        value.link ||
        value.href ||
        value.path ||
        "";
  const text = String(raw || "").trim();
  if (!text) return null;
  return text.replace("{size}", "500");
}

function enrichedImageValue(listing, fallback) {
  const listingImage = firstValue(listing, [
    "imageUrl",
    "mainImageUrl",
    "images.0",
    "images.0.url",
    "product.imageUrl",
    "product.images.0",
    "product.images.0.url",
  ]);
  const fallbackImage =
    fallback?.images?.[0] ||
    fallback?.imageUrl ||
    fallback?.mainImageUrl ||
    fallback?.product_image_url ||
    null;
  return normalizeImageUrl(listingImage) || normalizeImageUrl(fallbackImage);
}

class SyncService {
  constructor({ db, trendyol, hepsiburada, audit }) {
    this.db = db;
    this.trendyol = trendyol;
    this.hepsiburada = hepsiburada;
    this.audit = audit;
  }

  async products() {
    let page = 0,
      processed = 0;
    const seenBarcodes = new Set();
    while (true) {
      const data = await this.trendyol.listProducts(page, 100);
      const products = data.content || [];
      for (const product of products) {
        const barcode = String(product.barcode || "").trim();
        if (!barcode) continue;
        seenBarcodes.add(barcode);
        const salePrice = Number(product.salePrice) || 0;
        const quantity = Number(product.quantity) || 0;
        const active = Boolean(
          product.approved &&
          product.onSale &&
          !product.archived &&
          !product.locked &&
          quantity > 0 &&
          salePrice > 0,
        );
        await this.db.query(
          `INSERT INTO products(
	          marketplace,barcode,product_name,brand,category_name,category_id,product_image_url,my_price,list_price,stock_quantity,
	          archived,locked,on_sale,approved,commission_rate,trendyol_commission_rate,base_commission_rate,
	          special_commission_active,special_commission_checked_at,special_commission_note,
	          is_active,updated_at
	        )VALUES(
	          'TRENDYOL',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$14,
	          FALSE,CASE WHEN $14::numeric IS NULL THEN NULL ELSE NOW() END,NULL,$15,NOW()
	        )
	        ON CONFLICT(marketplace,barcode)DO UPDATE SET product_name=EXCLUDED.product_name,brand=EXCLUDED.brand,
	        category_name=EXCLUDED.category_name,category_id=EXCLUDED.category_id,product_image_url=EXCLUDED.product_image_url,
	        my_price=EXCLUDED.my_price,
        list_price=EXCLUDED.list_price,stock_quantity=EXCLUDED.stock_quantity,archived=EXCLUDED.archived,
        locked=EXCLUDED.locked,on_sale=EXCLUDED.on_sale,approved=EXCLUDED.approved,
        commission_rate=EXCLUDED.commission_rate,
        trendyol_commission_rate=EXCLUDED.trendyol_commission_rate,
        base_commission_rate=EXCLUDED.base_commission_rate,
        special_commission_checked_at=EXCLUDED.special_commission_checked_at,
        special_commission_active=FALSE,
        special_commission_note=NULL,
        is_active=EXCLUDED.is_active,updated_at=NOW()`,
          [
            barcode,
            product.title || "",
            product.brand || "",
            product.categoryName || "",
            String(product.pimCategoryId || product.categoryId || ""),
            product.productImageUrl || null,
            salePrice,
            Number(product.listPrice) || 0,
            quantity,
            Boolean(product.archived),
            Boolean(product.locked),
            Boolean(product.onSale),
            Boolean(product.approved),
            product.commission == null ? null : Number(product.commission),
            active,
          ],
        );
        processed++;
      }
      if (data.last === true || products.length === 0) break;
      page++;
    }
    if (seenBarcodes.size) {
      await this.db.query(
        `UPDATE products
         SET is_active=FALSE,on_sale=FALSE,updated_at=NOW()
         WHERE marketplace='TRENDYOL' AND NOT (barcode=ANY($1::text[]))`,
        [[...seenBarcodes]],
      );
    }
    return { processed, successful: processed, failed: 0 };
  }

  async hepsiburadaProducts() {
    if (!this.hepsiburada?.configured?.())
      return {
        processed: 0,
        successful: 0,
        failed: 0,
        metadata: { skipped: "HEPSIBURADA_CREDENTIALS_MISSING" },
      };
    const listings = await this.hepsiburada.fetchAllListings({
      pageSize: 100,
      maxPages: 200,
    });
    let processed = 0;
    const seenBarcodes = new Set();
    let metadataRows = [];
    let metadataError = null;
    let metadataLookupCount = 0;
    if (this.hepsiburada.fetchAllMerchantProducts) {
      try {
        metadataRows = await this.hepsiburada.fetchAllMerchantProducts({
          pageSize: 1000,
          maxPages: 200,
        });
      } catch (error) {
        metadataError = error.message;
      }
    }
    const metadataByKey = new Map();
    for (const product of metadataRows)
      addMetadataIndex(metadataByKey, product);
    const listingByKey = new Map();
    for (const listing of listings) addMetadataIndex(listingByKey, listing);
    if (
      metadataByKey.size === 0 &&
      this.hepsiburada.getMerchantProductMetadata
    ) {
      for (const listing of listings.slice(0, 1000)) {
        const merchantSku = hepsiburadaListingBarcode(listing);
        const hbSku = hepsiburadaListingPlatformId(listing);
        if (!merchantSku && !hbSku) continue;
        try {
          const product = await this.hepsiburada.getMerchantProductMetadata({
            merchantSku,
            hbSku,
          });
          metadataLookupCount++;
          if (product) {
            metadataRows.push(product);
            addMetadataIndex(metadataByKey, product);
          }
        } catch (error) {
          metadataError ||= error.message;
        }
      }
    }
    const listingBarcodes = [
      ...new Set(
        listings
          .map((listing) => hepsiburadaListingBarcode(listing))
          .filter(Boolean),
      ),
    ];
    const fallbackRows = listingBarcodes.length
      ? (
          await this.db.query(
            `SELECT barcode,product_name,brand,category_name,category_id,product_image_url
             FROM products WHERE marketplace='TRENDYOL' AND barcode=ANY($1::text[])`,
            [listingBarcodes],
          )
        ).rows
      : [];
    const fallbackByBarcode = new Map(
      fallbackRows.map((row) => [String(row.barcode), row]),
    );
    const syncRows = [];
    const syncedListingKeys = new Set();
    for (const product of metadataRows) {
      const listing = listingForMetadata(listingByKey, product) || {};
      const listingKey = normalizedKey(hepsiburadaListingBarcode(listing));
      if (listingKey) syncedListingKeys.add(listingKey);
      syncRows.push({ product, listing });
    }
    for (const listing of listings) {
      const listingKey = normalizedKey(hepsiburadaListingBarcode(listing));
      if (listingKey && syncedListingKeys.has(listingKey)) continue;
      syncRows.push({
        product: metadataForListing(metadataByKey, listing) || null,
        listing,
      });
    }
    for (const row of syncRows) {
      const { listing, product } = row;
      const barcode =
        hepsiburadaListingBarcode(listing) ||
        (product ? hepsiburadaCatalogBarcode(product) : "");
      if (!barcode) continue;
      const platformId =
        (product ? hepsiburadaCatalogPlatformId(product) : "") ||
        hepsiburadaListingPlatformId(listing);
      const fallbackProduct =
        product ||
        metadataForListing(metadataByKey, listing) ||
        fallbackByBarcode.get(barcode);
      seenBarcodes.add(barcode);
      const saleSource = Object.keys(listing || {}).length ? listing : product;
      const salePrice = hepsiburadaListingPrice(saleSource || {});
      const quantity = hepsiburadaListingStock(saleSource || {});
      const buybox = hepsiburadaListingBuybox(listing);
      const status = String(
        firstValue(saleSource, ["status", "listingStatus", "saleStatus"], ""),
      ).toUpperCase();
      const salable =
        typeof listing.isSalable === "boolean" ? listing.isSalable : null;
      const archived = ["DELETED", "ARCHIVED", "CLOSED"].includes(status);
      const approved = !["REJECTED", "BLOCKED"].includes(status);
      const onSale =
        salable !== false &&
        !archived &&
        !["PASSIVE", "INACTIVE"].includes(status);
      const active = approved && onSale && quantity > 0 && salePrice > 0;
      await this.db.query(
        `INSERT INTO products(
          marketplace,barcode,product_name,brand,category_name,category_id,
          product_image_url,marketplace_product_id,my_price,list_price,
          stock_quantity,archived,locked,on_sale,approved,commission_rate,
          buybox_price,second_price,third_price,rank,has_multiple_seller,
          buybox_updated_at,is_active,updated_at
        )VALUES(
          'HEPSIBURADA',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,$12,$13,$14,
          $15,$16,$17,$18,$19,CASE WHEN $15::numeric IS NULL AND $18::integer IS NULL THEN NULL ELSE NOW() END,$20,NOW()
        )
        ON CONFLICT(marketplace,barcode)DO UPDATE SET
          product_name=COALESCE(NULLIF(EXCLUDED.product_name,''),products.product_name),
          brand=COALESCE(NULLIF(EXCLUDED.brand,''),products.brand),
          category_name=COALESCE(NULLIF(EXCLUDED.category_name,''),products.category_name),
          category_id=COALESCE(NULLIF(EXCLUDED.category_id,''),products.category_id),
          product_image_url=COALESCE(NULLIF(EXCLUDED.product_image_url,''),products.product_image_url),
          marketplace_product_id=COALESCE(NULLIF(EXCLUDED.marketplace_product_id,''),products.marketplace_product_id),
          my_price=EXCLUDED.my_price,
          list_price=EXCLUDED.list_price,
          stock_quantity=EXCLUDED.stock_quantity,
          archived=EXCLUDED.archived,
          locked=EXCLUDED.locked,
          on_sale=EXCLUDED.on_sale,
          approved=EXCLUDED.approved,
          commission_rate=COALESCE(EXCLUDED.commission_rate,products.commission_rate),
          buybox_price=COALESCE(EXCLUDED.buybox_price,products.buybox_price),
          second_price=COALESCE(EXCLUDED.second_price,products.second_price),
          third_price=COALESCE(EXCLUDED.third_price,products.third_price),
          rank=COALESCE(EXCLUDED.rank,products.rank),
          has_multiple_seller=COALESCE(EXCLUDED.has_multiple_seller,products.has_multiple_seller),
          buybox_updated_at=COALESCE(EXCLUDED.buybox_updated_at,products.buybox_updated_at),
          is_active=EXCLUDED.is_active,
          updated_at=NOW()`,
        [
          barcode,
          enrichedListingValue(
            listing,
            fallbackProduct,
            ["productName", "name", "title", "product.name"],
            fallbackProduct?.productName ? "productName" : "product_name",
          ),
          enrichedListingValue(
            listing,
            fallbackProduct,
            ["brand", "brandName", "product.brand"],
            "brand",
          ),
          enrichedListingValue(
            listing,
            fallbackProduct,
            ["categoryName", "category.name", "product.categoryName"],
            "category_name",
          ),
          String(
            enrichedListingValue(
              listing,
              fallbackProduct,
              ["categoryId", "category.id", "product.categoryId"],
              "category_id",
            ),
          ),
          firstValue(listing, [], enrichedImageValue(listing, fallbackProduct)),
          platformId,
          salePrice,
          Number(
            firstValue(listing, ["listPrice", "originalPrice"], salePrice),
          ) || salePrice,
          quantity,
          archived,
          onSale,
          approved,
          firstValue(listing, ["commissionRate", "commission"], null) == null
            ? null
            : Number(
                firstValue(listing, ["commissionRate", "commission"], null),
              ),
          buybox.buyboxPrice,
          buybox.secondPrice,
          buybox.thirdPrice,
          buybox.rank,
          buybox.hasMultipleSeller,
          active,
        ],
      );
      processed++;
    }
    if (seenBarcodes.size) {
      await this.db.query(
        `UPDATE products
         SET is_active=FALSE,on_sale=FALSE,archived=TRUE,updated_at=NOW()
         WHERE marketplace='HEPSIBURADA' AND NOT (barcode=ANY($1::text[]))`,
        [[...seenBarcodes]],
      );
    }
    return {
      processed,
      successful: processed,
      failed: 0,
      metadata: {
        hepsiburadaCatalogProducts: metadataRows.length,
        hepsiburadaCatalogError: metadataError,
        hepsiburadaCatalogLookupCount: metadataLookupCount,
      },
    };
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
         FROM products WHERE marketplace='TRENDYOL' AND is_active=TRUE
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

  async adaptiveBuybox({ limit = 120 } = {}) {
    const due = (
      await this.db.query(
        `SELECT p.barcode,p.has_multiple_seller,p.auto_update,
                COALESCE(ps.mode,'MANUAL') mode,
                COALESCE(ps.auto_update,p.auto_update,FALSE) setting_auto_update
         FROM products p
         LEFT JOIN product_settings ps
           ON ps.marketplace=p.marketplace AND ps.barcode=p.barcode
         WHERE p.marketplace='TRENDYOL' AND p.is_active=TRUE
           AND COALESCE(ps.adaptive_sync_enabled,TRUE)=TRUE
           AND COALESCE(
             ps.next_buybox_sync_at,
             p.buybox_updated_at,
             '-infinity'::timestamptz
           )<=NOW()
         ORDER BY COALESCE(ps.next_buybox_sync_at,p.buybox_updated_at) NULLS FIRST
         LIMIT $1`,
        [Math.min(Math.max(Number(limit) || 120, 1), 500)],
      )
    ).rows;
    if (!due.length)
      return { processed: 0, successful: 0, failed: 0, metadata: { due: 0 } };
    const result = await this.buybox(due.map((row) => row.barcode));
    const updated = new Set(result.updatedBarcodes || []);
    for (const product of due) {
      if (!updated.has(product.barcode)) {
        await this.db.query(
          `INSERT INTO product_settings(
             marketplace,barcode,adaptive_sync_enabled,adaptive_sync_minutes,
             next_buybox_sync_at,updated_at
           )VALUES('TRENDYOL',$1,TRUE,5,NOW()+INTERVAL '5 minutes',NOW())
           ON CONFLICT(marketplace,barcode)WHERE barcode IS NOT NULL
           DO UPDATE SET adaptive_sync_minutes=5,
             next_buybox_sync_at=NOW()+INTERVAL '5 minutes',updated_at=NOW()`,
          [product.barcode],
        );
        continue;
      }
      const stats = (
        await this.db.query(
          `SELECT COUNT(*) observations,
                  COUNT(DISTINCT buybox_price) price_states,
                  COUNT(DISTINCT rank) rank_states
           FROM repricer_observations
           WHERE marketplace='TRENDYOL' AND barcode=$1
             AND observed_at>NOW()-INTERVAL '24 hours'`,
          [product.barcode],
        )
      ).rows[0];
      const priceStates = Number(stats.price_states || 0);
      const rankStates = Number(stats.rank_states || 0);
      const automatic =
        product.mode === "AUTOMATIC" && Boolean(product.setting_auto_update);
      let minutes;
      if (automatic && (priceStates >= 8 || rankStates >= 5)) minutes = 1;
      else if (automatic && (priceStates >= 4 || rankStates >= 3)) minutes = 5;
      else if (automatic && product.has_multiple_seller) minutes = 15;
      else if (automatic) minutes = 60;
      else if (priceStates >= 4 || rankStates >= 3) minutes = 60;
      else if (product.has_multiple_seller) minutes = 360;
      else minutes = 1440;
      const score = Math.min(
        100,
        priceStates * 8 +
          rankStates * 12 +
          (product.has_multiple_seller ? 10 : 0),
      );
      await this.db.query(
        `INSERT INTO product_settings(
           marketplace,barcode,adaptive_sync_enabled,adaptive_sync_minutes,
           next_buybox_sync_at,competition_score,updated_at
         )VALUES('TRENDYOL',$1,TRUE,$2::integer,NOW()+(($3::text||' minutes')::interval),$4,NOW())
         ON CONFLICT(marketplace,barcode)WHERE barcode IS NOT NULL
         DO UPDATE SET adaptive_sync_minutes=EXCLUDED.adaptive_sync_minutes,
           next_buybox_sync_at=EXCLUDED.next_buybox_sync_at,
           competition_score=EXCLUDED.competition_score,updated_at=NOW()`,
        [product.barcode, minutes, String(minutes), score],
      );
    }
    return {
      ...result,
      metadata: {
        due: due.length,
        adaptive: true,
      },
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
