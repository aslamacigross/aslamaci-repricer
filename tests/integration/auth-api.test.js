const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../../src/app");
const {
  AuthService,
  hashPassword,
} = require("../../src/services/auth.service");
function container() {
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
  const action = { id: 1, status: "PENDING", barcode: product.barcode };
  return {
    auth,
    db: { query: async () => ({ rows: [{}] }) },
    audit: {
      record: async () => {},
      list: async () => [{ action: "LOGIN_SUCCESS" }],
    },
    sheets: { health: () => ({ configured: false }) },
    trendyol: { configured: () => false },
    dashboard: { get: async () => ({ kpis: { total_products: 1 } }) },
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
    },
    actions: {
      list: async () => [action],
      get: async () => action,
      learningList: no,
    },
    actionService: {
      approve: async () => ({ ...action, status: "APPROVED" }),
      reject: async () => ({ ...action, status: "REJECTED" }),
      apply: async () => ({ ...action, status: "DRY_RUN" }),
    },
    jobs: {},
    jobService: { run: async () => ({ status: "SUCCESS" }) },
    settings: { list: no },
    sync: { health: async () => ({}) },
    learning: { checkOutcomes: async () => ({ processed: 1 }) },
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
test(
  "panel root istegi legacy koruma katmaninda beklemez",
  { timeout: 1000 },
  async () => {
    await request(createApp(container())).get("/").expect(200);
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
