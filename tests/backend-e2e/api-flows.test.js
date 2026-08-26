const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { migrate } = require("../../src/db/migrate");
const { createApp } = require("../../src/app");
const { createContainer } = require("../../src/container");
const {
  AuthService,
  hashPassword,
} = require("../../src/services/auth.service");
const { createPglitePool } = require("../helpers/pglite-pool");

async function login(app) {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ username: "admin", password: "test-password" })
    .expect(200);
  return {
    Cookie: response.headers["set-cookie"],
    "X-CSRF-Token": response.body.csrfToken,
  };
}

test("gercek Express ve gecici PostgreSQL kritik dry-run akislari", async () => {
  const db = await createPglitePool();
  try {
    await migrate("up", db);
    const container = createContainer({
      db,
      auth: new AuthService({
        username: "admin",
        passwordHash: hashPassword("test-password", "backend-e2e-salt"),
        secret: "backend-e2e-session-secret-32-chars",
      }),
      trendyol: { configured: () => true },
      hepsiburada: { configured: () => false },
    });
    const app = createApp(container);
    const headers = await login(app);

    const integrations = await request(app)
      .get("/api/integrations")
      .set("Cookie", headers.Cookie)
      .expect(200);
    assert.equal(integrations.body.items.length, 6);
    assert.equal(
      integrations.body.items.find((item) => item.code === "TRENDYOL")
        .credentials_configured,
      true,
    );
    assert.equal(
      integrations.body.items.find((item) => item.code === "HEPSIBURADA")
        .credentials_configured,
      false,
    );

    await db.query(
      `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
       VALUES('ACTISOFT_MENEKSE_1500','Menekşe Çamaşır Yumuşatıcısı 1,5 L',112,1.5)`,
    );
    const recipeResponse = await request(app)
      .post("/api/pim/recipes")
      .set(headers)
      .send({
        recipeName: "Menekşe Çamaşır Yumuşatıcısı 1,5 L x 2",
        components: [{ costItemCode: "ACTISOFT_MENEKSE_1500", quantity: 2 }],
      })
      .expect(201);
    const recipeId = recipeResponse.body.data.id;
    await db.query(
      `UPDATE pim_physical_products SET brand='Actisoft',
         product_family='Çamaşır Yumuşatıcısı',variant='Menekşe',volume_ml=1500
       WHERE cost_item_code='ACTISOFT_MENEKSE_1500'`,
    );
    await request(app)
      .post(`/api/pim/recipes/${recipeId}/approve`)
      .set(headers)
      .send({ confirmation: "RECETEYI_ONAYLA" })
      .expect(200);

    const catalog = await request(app)
      .post("/api/catalog-matches/preview")
      .set(headers)
      .send({
        recipeId,
        candidates: [
          {
            marketplaceProductId: "TY-CATALOG-1",
            productName: "Actisoft Menekşe Yumuşatıcı 1500 ml 2'li",
            brand: "Actisoft",
            productFamily: "Yumuşatıcı",
            variant: "Menekşe",
            unitVolumeMl: 1500,
            packCount: 2,
            components: [
              {
                costItemCode: "ACTISOFT_MENEKSE_1500",
                quantity: 2,
                variant: "Menekşe",
              },
            ],
          },
        ],
      })
      .expect(200);
    assert.equal(catalog.body.items[0].status, "REVIEW_REQUIRED");

    await db.query(
      `INSERT INTO marketplace_listings(
         marketplace,recipe_id,seller_listing_barcode,marketplace_category_id,
         title,description,stock,sale_price_minor,listing_status,publication_state
       )VALUES('HEPSIBURADA',$1,'HB-MENEKSE-2','HB-CAT-1',
         'Menekşe Yumuşatıcı 1,5 L x 2','Kaynak listing',5,39999,'ACTIVE','PUBLISHED')`,
      [recipeId],
    );
    await db.query(
      `INSERT INTO listing_barcode_pools(
         marketplace,barcode,status,assigned_recipe_id,allocation_key,assigned_at
       )VALUES('TRENDYOL','TY-MENEKSE-2','RESERVED',$1,$2,NOW())`,
      [recipeId, `TRENDYOL:${recipeId}`],
    );
    await db.query(
      `INSERT INTO marketplace_categories(marketplace,category_id,category_name,leaf)
       VALUES('TRENDYOL','TY-CAT-1','Çamaşır Yumuşatıcıları',TRUE)`,
    );
    await db.query(
      `INSERT INTO commission_rules(marketplace,category_id,category_name,commission_rate)
       VALUES('TRENDYOL','TY-CAT-1','Çamaşır Yumuşatıcıları',17)`,
    );
    await db.query(
      `INSERT INTO shipping_costs(marketplace,desi_kg,carrier,cost_ex_vat,cost_inc_vat)
       VALUES('TRENDYOL',3,'TEX',80,96)
       ON CONFLICT(marketplace,desi_kg,carrier)DO UPDATE SET
         cost_ex_vat=EXCLUDED.cost_ex_vat,
         cost_inc_vat=EXCLUDED.cost_inc_vat`,
    );
    await db.query(
      `INSERT INTO packaging_rules(marketplace,min_desi,max_desi,packaging_cost)
       VALUES('TRENDYOL',1,5,15)`,
    );

    const publicationInput = {
      recipeId,
      sourceMarketplace: "HEPSIBURADA",
      targetMarketplace: "TRENDYOL",
      targetCategoryId: "TY-CAT-1",
      targetBrandId: "ACTISOFT",
      stock: 5,
      requestedPrice: 399.99,
    };
    const preview = await request(app)
      .post("/api/publication-drafts/preview")
      .set(headers)
      .send(publicationInput)
      .expect(200);
    assert.equal(preview.body.data.dryRun, true);
    assert.equal(preview.body.data.mutationPerformed, false);
    assert.equal(
      preview.body.data.payload.sellerListingBarcode,
      "TY-MENEKSE-2",
    );
    assert.equal(preview.body.data.payload.marketplaceCatalogBarcode, null);

    const transferInput = {
      sourceMarketplace: "HEPSIBURADA",
      targetMarketplace: "TRENDYOL",
      recipeIds: [recipeId],
      idempotencyKey: "backend-e2e-transfer-key",
    };
    const firstTransfer = await request(app)
      .post("/api/channel-transfers")
      .set(headers)
      .send(transferInput)
      .expect(201);
    const secondTransfer = await request(app)
      .post("/api/channel-transfers")
      .set(headers)
      .send(transferInput)
      .expect(201);
    assert.equal(secondTransfer.body.data.id, firstTransfer.body.data.id);
    for (const table of [
      "channel_transfer_batches",
      "channel_transfer_items",
      "product_publication_drafts",
    ]) {
      const count = await db.query(`SELECT COUNT(*)::int count FROM ${table}`);
      assert.equal(count.rows[0].count, 1, `${table} duplicate içeriyor`);
    }

    const opportunity = (
      await db.query(
        `INSERT INTO product_opportunities(
           opportunity_key,opportunity_type,target_marketplace,recipe_id,
           proposed_recipe,score,confidence,signal_breakdown,economics_json,
           catalog_status,data_quality,generation_reason
         )VALUES('backend-e2e-opportunity','MISSING_MARKETPLACE','TRENDYOL',$1,
           '{}'::jsonb,80,'HIGH','[]'::jsonb,'{}'::jsonb,'NOT_SEARCHED',
           '{}'::jsonb,'E2E') RETURNING id`,
        [recipeId],
      )
    ).rows[0];
    const approvedOpportunity = await request(app)
      .post(`/api/opportunities/${opportunity.id}/approve-recipe`)
      .set(headers)
      .send({ confirmation: "FIRSAT_RECETESINI_ONAYLA" })
      .expect(200);
    assert.equal(
      approvedOpportunity.body.data.workflow_status,
      "RECIPE_APPROVED",
    );

    const generatedContent = await request(app)
      .post("/api/content-drafts/generate")
      .set(headers)
      .send({
        marketplace: "TRENDYOL",
        recipeId,
        confirmation: "ICERIK_TASLAGI_URET",
      })
      .expect(201);
    const contentId = generatedContent.body.data.draft.id;
    await request(app)
      .post(`/api/content-drafts/${contentId}/approve`)
      .set(headers)
      .send({ confirmation: "ICERIGI_ONAYLA" })
      .expect(200);
    const contentDryRun = await request(app)
      .post(`/api/content-drafts/${contentId}/publish-dry-run`)
      .set(headers)
      .send({ confirmation: "ICERIK_DRY_RUN_ONAYLA" })
      .expect(200);
    assert.equal(contentDryRun.body.data.dryRun, true);
    assert.equal(contentDryRun.body.data.mutationPerformed, false);
    assert.ok(
      contentDryRun.body.data.blockers.includes("CONTENT_AUTO_UPDATE_DISABLED"),
    );
  } finally {
    await db.end();
  }
});
