const {
  bundleFingerprint,
  recipeType,
  listingBarcodeCandidate,
} = require("../domain/pim");

function bounded(value, fallback = 50, maximum = 200) {
  return Math.min(Math.max(Number(value) || fallback, 1), maximum);
}

function toMinor(value) {
  return Math.round(Number(value || 0) * 100);
}

class PimRepository {
  constructor(db, withTransaction) {
    this.db = db;
    this.withTransaction = withTransaction;
  }

  async listPhysicalProducts(filters = {}) {
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = bounded(filters.limit);
    const params = [];
    const where = [];
    if (filters.search) {
      params.push(`%${String(filters.search).trim()}%`);
      where.push(
        `(product_name ILIKE $${params.length} OR brand ILIKE $${params.length} OR cost_item_code ILIKE $${params.length})`,
      );
    }
    if (filters.status) {
      params.push(String(filters.status).toUpperCase());
      where.push(`status=$${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await this.db.query(
      `SELECT COUNT(*)::int total FROM pim_physical_products ${clause}`,
      params,
    );
    params.push(limit, (page - 1) * limit);
    const items = await this.db.query(
      `SELECT * FROM pim_physical_products ${clause}
       ORDER BY updated_at DESC,id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: items.rows, total: count.rows[0].total, page, limit };
  }

  async listRecipes(filters = {}) {
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = bounded(filters.limit);
    const params = [];
    const where = [];
    if (filters.search) {
      params.push(`%${String(filters.search).trim()}%`);
      where.push(
        `(r.recipe_name ILIKE $${params.length} OR r.recipe_code ILIKE $${params.length})`,
      );
    }
    if (filters.status) {
      params.push(String(filters.status).toUpperCase());
      where.push(`r.status=$${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await this.db.query(
      `SELECT COUNT(*)::int total FROM pim_recipes r ${clause}`,
      params,
    );
    params.push(limit, (page - 1) * limit);
    const items = await this.db.query(
      `SELECT r.*,COUNT(c.id)::int component_count,
              COUNT(l.id)::int listing_count
       FROM pim_recipes r
       LEFT JOIN pim_recipe_components c ON c.recipe_id=r.id
       LEFT JOIN marketplace_listings l ON l.recipe_id=r.id
       ${clause}
       GROUP BY r.id ORDER BY r.updated_at DESC,r.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: items.rows, total: count.rows[0].total, page, limit };
  }

  async getRecipe(id, queryable = this.db) {
    const recipe = (
      await queryable.query(`SELECT * FROM pim_recipes WHERE id=$1`, [id])
    ).rows[0];
    if (!recipe) return null;
    recipe.components = (
      await queryable.query(
        `SELECT c.*,p.product_name,p.brand,p.product_family,p.variant,
                p.volume_ml,p.weight_g,p.units_per_pack,
                ci.unit_cost,ci.unit_desi
         FROM pim_recipe_components c
         JOIN pim_physical_products p ON p.id=c.physical_product_id
         JOIN cost_items ci ON ci.item_code=c.cost_item_code
         WHERE c.recipe_id=$1 ORDER BY c.id`,
        [id],
      )
    ).rows;
    recipe.listings = (
      await queryable.query(
        `SELECT * FROM marketplace_listings WHERE recipe_id=$1
         ORDER BY marketplace,id`,
        [id],
      )
    ).rows;
    return recipe;
  }

  async listListings(filters = {}) {
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = bounded(filters.limit);
    const params = [];
    const where = [];
    if (filters.marketplace) {
      params.push(String(filters.marketplace).toUpperCase());
      where.push(`l.marketplace=$${params.length}`);
    }
    if (filters.recipeId) {
      params.push(Number(filters.recipeId));
      where.push(`l.recipe_id=$${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await this.db.query(
      `SELECT COUNT(*)::int total FROM marketplace_listings l ${clause}`,
      params,
    );
    params.push(limit, (page - 1) * limit);
    const items = await this.db.query(
      `SELECT l.*,r.recipe_code,r.recipe_name,r.recipe_type
       FROM marketplace_listings l JOIN pim_recipes r ON r.id=l.recipe_id
       ${clause} ORDER BY l.updated_at DESC,l.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: items.rows, total: count.rows[0].total, page, limit };
  }

  async listBarcodePool(filters = {}) {
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = bounded(filters.limit);
    const params = [];
    const where = [];
    if (filters.marketplace) {
      params.push(String(filters.marketplace).toUpperCase());
      where.push(`b.marketplace=$${params.length}`);
    }
    if (filters.status) {
      params.push(String(filters.status).toUpperCase());
      where.push(`b.status=$${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await this.db.query(
      `SELECT COUNT(*)::int total FROM listing_barcode_pools b ${clause}`,
      params,
    );
    params.push(limit, (page - 1) * limit);
    const items = await this.db.query(
      `SELECT b.*,r.recipe_code,r.recipe_name
       FROM listing_barcode_pools b
       LEFT JOIN pim_recipes r ON r.id=b.assigned_recipe_id
       ${clause} ORDER BY b.created_at DESC,b.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: items.rows, total: count.rows[0].total, page, limit };
  }

  async bootstrapSummary() {
    const result = await this.db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM cost_items) physical_product_candidates,
         (SELECT COUNT(*)::int FROM products p WHERE EXISTS(
           SELECT 1 FROM product_cost_mappings m
           WHERE m.marketplace=p.marketplace AND m.barcode=p.barcode
         )) listing_candidates,
         (SELECT COUNT(*)::int FROM products WHERE recipe_id IS NULL) products_without_recipe,
         (SELECT COUNT(*)::int FROM pim_recipes) existing_recipes`,
    );
    return result.rows[0];
  }

  async listCatalogMatches(filters = {}) {
    const params = [];
    const where = [];
    if (filters.marketplace) {
      params.push(String(filters.marketplace).toUpperCase());
      where.push(`m.marketplace=$${params.length}`);
    }
    if (filters.recipeId) {
      params.push(Number(filters.recipeId));
      where.push(`m.recipe_id=$${params.length}`);
    }
    if (filters.status) {
      params.push(String(filters.status).toUpperCase());
      where.push(`m.match_status=$${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return (
      await this.db.query(
        `SELECT m.*,r.recipe_code,r.recipe_name
         FROM marketplace_catalog_matches m
         JOIN pim_recipes r ON r.id=m.recipe_id
         ${clause} ORDER BY m.updated_at DESC,m.id DESC LIMIT 500`,
        params,
      )
    ).rows;
  }

  async saveCatalogMatch(input) {
    return (
      await this.db.query(
        `INSERT INTO marketplace_catalog_matches(
           marketplace,recipe_id,marketplace_product_id,
           marketplace_catalog_barcode,marketplace_category_id,
           match_status,match_confidence,match_method,evidence_json
         )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT(marketplace,recipe_id,marketplace_product_id) DO UPDATE SET
           marketplace_catalog_barcode=EXCLUDED.marketplace_catalog_barcode,
           marketplace_category_id=EXCLUDED.marketplace_category_id,
           match_status=EXCLUDED.match_status,
           match_confidence=EXCLUDED.match_confidence,
           match_method=EXCLUDED.match_method,evidence_json=EXCLUDED.evidence_json,
           updated_at=NOW() RETURNING *`,
        [
          input.marketplace,
          input.recipeId,
          input.marketplaceProductId,
          input.marketplaceCatalogBarcode || null,
          input.marketplaceCategoryId || null,
          input.matchStatus,
          input.matchConfidence,
          input.matchMethod,
          JSON.stringify(input.evidence || {}),
        ],
      )
    ).rows[0];
  }

  async reviewCatalogMatch(id, { status, actor }) {
    return this.withTransaction(async (client) => {
      const match = (
        await client.query(
          `UPDATE marketplace_catalog_matches SET
             match_status=$2,reviewed_by=$3,reviewed_at=NOW(),updated_at=NOW()
           WHERE id=$1 RETURNING *`,
          [id, status, actor],
        )
      ).rows[0];
      if (!match) return null;
      if (status === "CONFIRMED")
        await client.query(
          `INSERT INTO marketplace_listing_identifiers(
             marketplace,recipe_id,marketplace_product_id,
             seller_listing_barcode,identifier_source,status
           )VALUES($1,$2,$3,NULL,'EXISTING_MARKETPLACE_CATALOG','ACTIVE')
           ON CONFLICT(
             marketplace,recipe_id,marketplace_product_id,identifier_source
           ) DO UPDATE SET status='ACTIVE',updated_at=NOW()`,
          [match.marketplace, match.recipe_id, match.marketplace_product_id],
        );
      return match;
    });
  }

  async createRecipe(input) {
    return this.withTransaction(async (client) => {
      const codes = input.components.map((item) => item.costItemCode);
      const costs = (
        await client.query(
          `SELECT * FROM cost_items WHERE item_code=ANY($1::text[])`,
          [codes],
        )
      ).rows;
      if (costs.length !== new Set(codes).size) {
        const found = new Set(costs.map((item) => item.item_code));
        const missing = [...new Set(codes)].filter((code) => !found.has(code));
        const error = new Error(`Maliyet kalemi bulunamadı: ${missing.join(", ")}`);
        error.code = "COST_ITEM_NOT_FOUND";
        throw error;
      }
      const byCode = new Map(costs.map((item) => [item.item_code, item]));
      const components = input.components.map((item) => ({
        costItemCode: item.costItemCode,
        quantity: Number(item.quantity),
      }));
      const fingerprint = bundleFingerprint(components);
      const totalCostMinor = components.reduce(
        (total, item) => total + toMinor(byCode.get(item.costItemCode).unit_cost) * item.quantity,
        0,
      );
      const fractionalDesi = components.reduce(
        (total, item) => total + Number(byCode.get(item.costItemCode).unit_desi || 0) * item.quantity,
        0,
      );
      const recipe = (
        await client.query(
          `INSERT INTO pim_recipes(
             recipe_code,recipe_name,recipe_type,bundle_fingerprint,
             total_cost_minor,fractional_desi,final_desi,packaging_type,
             packaging_cost_minor,target_profit_minor,status
           )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT(bundle_fingerprint) DO UPDATE SET updated_at=NOW()
           RETURNING *`,
          [
            input.recipeCode || `REC-${fingerprint.slice(0, 12).toUpperCase()}`,
            input.recipeName,
            recipeType(components),
            fingerprint,
            Math.round(totalCostMinor),
            fractionalDesi,
            Math.ceil(fractionalDesi),
            input.packagingType || null,
            Number(input.packagingCostMinor || 0),
            Number(input.targetProfitMinor || 4000),
            input.status || "DRAFT",
          ],
        )
      ).rows[0];
      for (const component of components) {
        const cost = byCode.get(component.costItemCode);
        const physical = (
          await client.query(
            `INSERT INTO pim_physical_products(
               canonical_key,product_name,cost_item_code
             )VALUES($1,$2,$1)
             ON CONFLICT(cost_item_code) DO UPDATE SET
               product_name=EXCLUDED.product_name,updated_at=NOW()
             RETURNING *`,
            [component.costItemCode, cost.item_name],
          )
        ).rows[0];
        await client.query(
          `INSERT INTO pim_recipe_components(
             recipe_id,physical_product_id,cost_item_code,quantity
           )VALUES($1,$2,$3,$4)
           ON CONFLICT(recipe_id,cost_item_code) DO UPDATE SET
             quantity=EXCLUDED.quantity,physical_product_id=EXCLUDED.physical_product_id,
             updated_at=NOW()`,
          [recipe.id, physical.id, component.costItemCode, component.quantity],
        );
      }
      return this.getRecipe(recipe.id, client);
    });
  }

  async bootstrapExisting() {
    return this.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO pim_physical_products(canonical_key,product_name,cost_item_code)
         SELECT item_code,item_name,item_code FROM cost_items
         ON CONFLICT(cost_item_code) DO UPDATE SET
           product_name=EXCLUDED.product_name,updated_at=NOW()`,
      );
      const rows = (
        await client.query(
          `SELECT p.marketplace,p.barcode,p.product_name,p.marketplace_product_id,
                  p.category_id,p.stock_quantity,p.my_price,p.min_price,p.buybox_price,
                  p.rank,p.product_image_url,m.cost_item_code,m.quantity,
                  ci.item_name,ci.unit_cost,ci.unit_desi,pp.id physical_product_id
           FROM products p
           JOIN product_cost_mappings m
             ON m.marketplace=p.marketplace AND m.barcode=p.barcode
           JOIN cost_items ci ON ci.item_code=m.cost_item_code
           JOIN pim_physical_products pp ON pp.cost_item_code=m.cost_item_code
           ORDER BY p.marketplace,p.barcode,m.cost_item_code`,
        )
      ).rows;
      const groups = new Map();
      for (const row of rows) {
        const key = `${row.marketplace}:${row.barcode}`;
        if (!groups.has(key)) groups.set(key, { product: row, components: [] });
        groups.get(key).components.push({
          costItemCode: row.cost_item_code,
          physicalProductId: row.physical_product_id,
          quantity: Number(row.quantity),
          unitCost: Number(row.unit_cost),
          unitDesi: Number(row.unit_desi),
        });
      }
      let recipes = 0;
      let listings = 0;
      const seenRecipes = new Set();
      for (const group of groups.values()) {
        const fingerprint = bundleFingerprint(group.components);
        const totalCostMinor = Math.round(
          group.components.reduce((total, item) => total + item.unitCost * item.quantity, 0) * 100,
        );
        const fractionalDesi = group.components.reduce(
          (total, item) => total + item.unitDesi * item.quantity,
          0,
        );
        const recipe = (
          await client.query(
            `INSERT INTO pim_recipes(
               recipe_code,recipe_name,recipe_type,bundle_fingerprint,
               total_cost_minor,fractional_desi,final_desi,status
             )VALUES($1,$2,$3,$4,$5,$6,$7,'REVIEW')
             ON CONFLICT(bundle_fingerprint) DO UPDATE SET
               total_cost_minor=EXCLUDED.total_cost_minor,
               fractional_desi=EXCLUDED.fractional_desi,
               final_desi=EXCLUDED.final_desi,updated_at=NOW()
             RETURNING *`,
            [
              `REC-${fingerprint.slice(0, 12).toUpperCase()}`,
              group.product.product_name || group.product.barcode,
              recipeType(group.components),
              fingerprint,
              totalCostMinor,
              fractionalDesi,
              Math.ceil(fractionalDesi),
            ],
          )
        ).rows[0];
        if (!seenRecipes.has(recipe.id)) {
          recipes++;
          seenRecipes.add(recipe.id);
        }
        for (const component of group.components)
          await client.query(
            `INSERT INTO pim_recipe_components(
               recipe_id,physical_product_id,cost_item_code,quantity
             )VALUES($1,$2,$3,$4)
             ON CONFLICT(recipe_id,cost_item_code) DO UPDATE SET
               quantity=EXCLUDED.quantity,updated_at=NOW()`,
            [recipe.id, component.physicalProductId, component.costItemCode, component.quantity],
          );
        const listing = (
          await client.query(
            `INSERT INTO marketplace_listings(
               marketplace,recipe_id,marketplace_product_id,seller_listing_barcode,
               marketplace_category_id,title,images,stock,sale_price_minor,
               minimum_price_minor,buybox_price_minor,target_rank,listing_status,
               publication_state
             )VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,'IMPORTED','PUBLISHED')
             ON CONFLICT(marketplace,seller_listing_barcode) DO UPDATE SET
               recipe_id=EXCLUDED.recipe_id,marketplace_product_id=EXCLUDED.marketplace_product_id,
               marketplace_category_id=EXCLUDED.marketplace_category_id,title=EXCLUDED.title,
               images=EXCLUDED.images,stock=EXCLUDED.stock,sale_price_minor=EXCLUDED.sale_price_minor,
               minimum_price_minor=EXCLUDED.minimum_price_minor,
               buybox_price_minor=EXCLUDED.buybox_price_minor,target_rank=EXCLUDED.target_rank,
               updated_at=NOW()
             RETURNING id`,
            [
              group.product.marketplace,
              recipe.id,
              group.product.marketplace_product_id,
              group.product.barcode,
              group.product.category_id,
              group.product.product_name,
              JSON.stringify(group.product.product_image_url ? [group.product.product_image_url] : []),
              Number(group.product.stock_quantity || 0),
              toMinor(group.product.my_price),
              toMinor(group.product.min_price),
              toMinor(group.product.buybox_price),
              group.product.rank,
            ],
          )
        ).rows[0];
        await client.query(
          `UPDATE products SET recipe_id=$3
           WHERE marketplace=$1 AND barcode=$2`,
          [group.product.marketplace, group.product.barcode, recipe.id],
        );
        await client.query(
          `INSERT INTO marketplace_listing_identifiers(
             marketplace,recipe_id,marketplace_product_id,seller_listing_barcode,
             external_listing_id,identifier_source,status
           )VALUES($1,$2,$3,$4,$3,'EXISTING_SELLER_LISTING','ACTIVE')
           ON CONFLICT(marketplace,seller_listing_barcode) DO UPDATE SET
             recipe_id=EXCLUDED.recipe_id,marketplace_product_id=EXCLUDED.marketplace_product_id,
             updated_at=NOW()`,
          [
            group.product.marketplace,
            recipe.id,
            group.product.marketplace_product_id,
            group.product.barcode,
          ],
        );
        if (listing) listings++;
      }
      return {
        processed: groups.size,
        successful: groups.size,
        failed: 0,
        recipes,
        listings,
      };
    });
  }

  async previewBarcode(marketplace, recipeId) {
    const recipe = await this.getRecipe(recipeId);
    if (!recipe) return null;
    const allocationKey = `${String(marketplace).toUpperCase()}:${recipe.id}`;
    const existing = (
      await this.db.query(
        `SELECT * FROM listing_barcode_pools WHERE allocation_key=$1`,
        [allocationKey],
      )
    ).rows[0];
    return {
      recipe,
      allocationKey,
      barcode:
        existing?.barcode ||
        listingBarcodeCandidate(marketplace, recipe.id, recipe.bundle_fingerprint),
      existing: Boolean(existing),
      status: existing?.status || "PREVIEW",
    };
  }

  async allocateBarcode({ marketplace, recipeId, requestedBarcode }) {
    return this.withTransaction(async (client) => {
      const normalizedMarketplace = String(marketplace).toUpperCase();
      const allocationKey = `${normalizedMarketplace}:${recipeId}`;
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `listing-barcode:${allocationKey}`,
      ]);
      const existing = (
        await client.query(
          `SELECT * FROM listing_barcode_pools WHERE allocation_key=$1`,
          [allocationKey],
        )
      ).rows[0];
      if (existing) return existing;
      const recipe = await this.getRecipe(recipeId, client);
      if (!recipe) return null;
      const barcode =
        requestedBarcode ||
        listingBarcodeCandidate(
          normalizedMarketplace,
          recipe.id,
          recipe.bundle_fingerprint,
        );
      return (
        await client.query(
          `INSERT INTO listing_barcode_pools(
             marketplace,barcode,status,assigned_recipe_id,allocation_key,
             identifier_source,assigned_at
           )VALUES($1,$2,'RESERVED',$3,$4,$5,NOW()) RETURNING *`,
          [
            normalizedMarketplace,
            barcode,
            recipe.id,
            allocationKey,
            requestedBarcode ? "MANUAL" : "GENERATED_FOR_NEW_LISTING",
          ],
        )
      ).rows[0];
    });
  }
}

module.exports = { PimRepository, toMinor };
