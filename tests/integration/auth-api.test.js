const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../../src/app");
const {
  AuthService,
  hashPassword,
} = require("../../src/services/auth.service");
function container(options = {}) {
  const auth = new AuthService({
    username: "admin",
    passwordHash: hashPassword("password-12345"),
    secret: "s".repeat(32),
  });
  const no = async () => [];
  const product = {
    barcode: "8690609598109",
    product_name: "Menekşe",
    min_price: 312.28,
    my_price: 329.9,
  };
  const action = {
    id: 1,
    status: "PENDING",
    barcode: product.barcode,
    marketplace: options.marketplace || "TRENDYOL",
  };
  const runJobs = [];
  return {
    auth,
    db: {
      query: async (sql) =>
        String(sql).includes("schema_migrations")
          ? {
              rows:
                options.migration === false
                  ? []
                  : [{ version: "027_packaging_profiles" }],
              rowCount: options.migration === false ? 0 : 1,
            }
          : { rows: [{}], rowCount: 1 },
    },
    audit: {
      record: async () => {},
      list: async () => [{ action: "LOGIN_SUCCESS" }],
    },
    trendyol: { configured: () => false },
    dashboard: {
      get: async () => ({
        kpis: { total_products: 1 },
        jobs: runJobs.map((job_name) => ({ job_name, last_status: "SUCCESS" })),
      }),
      metricDetails: async (metric) => ({
        type: metric.includes("actions") ? "actions" : "products",
        limit: 100,
        items: [product],
      }),
    },
    products: {
      list: async () => ({ items: [product], total: 1, page: 1, limit: 50 }),
      get: async () => product,
      breakdown: async () => ({ product, mappings: [] }),
      history: no,
    },
    costEngine: { recalculate: async () => ({ processed: 1 }) },
    costs: {},
    repricer: {
      globalSettings: async () => ({ dryRun: true }),
      preview: async () => [
        { barcode: product.barcode, proposedPrice: 320, action: "FIYAT_DUSUR" },
      ],
      generate: async () => ({ created: 1 }),
      ensureSupportedMarketplace: (marketplace) => marketplace,
    },
    actions: {
      list: async () => [action],
      get: async () => action,
      learningList: no,
    },
    actionService: {
      approve: async () => ({ ...action, status: "APPROVED" }),
      editAndApprove: async (id, input) => ({
        ...action,
        id,
        proposed_price: input.proposedPrice,
        status: "APPROVED",
      }),
      reject: async () => ({ ...action, status: "REJECTED" }),
      apply: async () => ({ ...action, status: "DRY_RUN" }),
    },
    hepsiburadaActionService: {
      apply: async () => ({ ...action, status: "AWAITING_RESULT" }),
    },
    jobs: {},
    jobService: {
      run: async (name) => {
        runJobs.push(name);
        return { job_name: name, status: "SUCCESS", processed_count: 1 };
      },
    },
    settings: {
      list: no,
      getAll: async () => ({ maintenance_mode: Boolean(options.maintenance) }),
    },
    sync: { health: async () => ({}) },
    learning: { checkOutcomes: async () => ({ processed: 1 }) },
    hepsiburadaLearning: { checkOutcomes: async () => ({ processed: 1 }) },
  };
}
test("login HttpOnly session verir ve me endpointi calisir", async () => {
  const app = createApp(container());
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "admin", password: "password-12345" })
    .expect(200);
  assert.match(login.headers["set-cookie"][0], /HttpOnly/);
  const me = await request(app)
    .get("/api/auth/me")
    .set("Cookie", login.headers["set-cookie"])
    .expect(200);
  assert.equal(me.body.user.username, "admin");
});
test("korumali endpoint oturumsuz 401 verir", async () => {
  await request(createApp(container())).get("/api/dashboard").expect(401);
});
test("readiness gerekli migration uygulandiginda hazir doner", async () => {
  await request(createApp(container()))
    .get("/ready")
    .expect(200)
    .expect((res) => assert.equal(res.body.status, "ready"));
});
test("readiness eksik migrationda trafige hazir olmadigini bildirir", async () => {
  await request(createApp(container({ migration: false })))
    .get("/ready")
    .expect(503)
    .expect((res) => assert.equal(res.body.status, "not_ready"));
});
test(
  "panel root istegi uygulama kabugunu dondurur",
  { timeout: 1000 },
  async () => {
    await request(createApp(container()))
      .get("/")
      .expect(200)
      .expect((res) => assert.match(res.headers["cache-control"], /no-store/));
  },
);
test("mutasyon CSRF olmadan engellenir", async () => {
  const app = createApp(container());
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "admin", password: "password-12345" });
  await request(app)
    .post("/api/repricer/preview")
    .set("Cookie", login.headers["set-cookie"])
    .send({})
    .expect(403);
});
test("bakim modu ayarlar disindaki mutasyonlari durdurur", async () => {
  const app = createApp(container({ maintenance: true }));
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "admin", password: "password-12345" });
  await request(app)
    .post("/api/repricer/preview")
    .set({
      Cookie: login.headers["set-cookie"],
      "X-CSRF-Token": login.body.csrfToken,
    })
    .send({})
    .expect(503)
    .expect((res) => assert.equal(res.body.code, "MAINTENANCE_MODE"));
  await request(app)
    .get("/api/dashboard")
    .set("Cookie", login.headers["set-cookie"])
    .expect(200);
});
test("dashboard canlı yenileme güvenli veri joblarını sırayla çalıştırır", async () => {
  const app = createApp(container());
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "admin", password: "password-12345" });
  await request(app)
    .post("/api/dashboard/live-refresh")
    .set({
      Cookie: login.headers["set-cookie"],
      "X-CSRF-Token": login.body.csrfToken,
    })
    .send({})
    .expect(200)
    .expect((res) => {
      assert.deepEqual(
        res.body.data.runs.map((run) => run.job_name),
        [
          "sync-products",
          "calculate-costs",
          "sync-buybox",
          "dashboard-cache-refresh",
        ],
      );
      assert.equal(res.body.data.dashboard.kpis.total_products, 1);
    });
});
test("Hepsiburada canlı yenileme yalnız mevcut HB veri joblarını çalıştırır", async () => {
  const app = createApp(container());
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "admin", password: "password-12345" });
  await request(app)
    .post("/api/dashboard/live-refresh")
    .set({
      Cookie: login.headers["set-cookie"],
      "X-CSRF-Token": login.body.csrfToken,
    })
    .send({ marketplace: "HEPSIBURADA" })
    .expect(200)
    .expect((res) => {
      assert.deepEqual(
        res.body.data.runs.map((run) => run.job_name),
        ["sync-hepsiburada-products", "sync-hepsiburada-buybox"],
      );
    });
});
test("dashboard metrik detayi drawer icin kayit dondurur", async () => {
  const app = createApp(container());
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "admin", password: "password-12345" });
  await request(app)
    .get("/api/dashboard/metrics/missing_mapping")
    .set({ Cookie: login.headers["set-cookie"] })
    .expect(200)
    .expect((res) => {
      assert.equal(res.body.data.type, "products");
      assert.equal(res.body.data.items[0].barcode, "8690609598109");
    });
});
test("bekleyen fiyat aksiyonu panelden duzenlenip onaylanabilir", async () => {
  const app = createApp(container());
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "admin", password: "password-12345" });
  await request(app)
    .post("/api/actions/1/edit-and-approve")
    .set({
      Cookie: login.headers["set-cookie"],
      "X-CSRF-Token": login.body.csrfToken,
    })
    .send({ proposedPrice: 320 })
    .expect(200)
    .expect((res) => {
      assert.equal(res.body.data.status, "APPROVED");
      assert.equal(res.body.data.proposed_price, 320);
    });
});

test("HB aksiyon apply endpointi HB executorunu kullanir", async () => {
  const app = createApp(container({ marketplace: "HEPSIBURADA" }));
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "admin", password: "password-12345" });
  await request(app)
    .post("/api/actions/1/apply")
    .set({
      Cookie: login.headers["set-cookie"],
      "X-CSRF-Token": login.body.csrfToken,
    })
    .send({})
    .expect(200)
    .expect((res) => assert.equal(res.body.data.status, "AWAITING_RESULT"));
});
test("login-dashboard-urun-maliyet-repricer-dry-run-log akisi", async () => {
  const app = createApp(container());
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "admin", password: "password-12345" })
    .expect(200);
  const headers = {
    Cookie: login.headers["set-cookie"],
    "X-CSRF-Token": login.body.csrfToken,
  };
  await request(app)
    .get("/api/dashboard")
    .set("Cookie", headers.Cookie)
    .expect(200)
    .expect((res) => assert.equal(res.body.data.kpis.total_products, 1));
  await request(app)
    .get("/api/products")
    .set("Cookie", headers.Cookie)
    .expect(200);
  await request(app)
    .get("/api/products/8690609598109/cost-breakdown")
    .set("Cookie", headers.Cookie)
    .expect(200)
    .expect((res) => assert.equal(res.body.data.product.min_price, 312.28));
  await request(app)
    .post("/api/repricer/preview")
    .set(headers)
    .send({ barcode: "8690609598109" })
    .expect(200);
  await request(app)
    .post("/api/actions/1/approve")
    .set(headers)
    .send({})
    .expect(200);
  await request(app)
    .post("/api/actions/1/apply")
    .set(headers)
    .send({})
    .expect(200)
    .expect((res) => assert.equal(res.body.data.status, "DRY_RUN"));
  await request(app).get("/api/logs").set("Cookie", headers.Cookie).expect(200);
});
