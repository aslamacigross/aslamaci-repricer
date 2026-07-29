const test = require("node:test");
const request = require("supertest");
const { createApp } = require("../../src/app");
const { env } = require("../../src/config/env");
const {
  AuthService,
  hashPassword,
} = require("../../src/services/auth.service");

function container() {
  return {
    auth: new AuthService({
      username: "admin",
      passwordHash: hashPassword("password-12345"),
      secret: "s".repeat(32),
    }),
    db: { query: async () => ({ rows: [{ version: "test" }], rowCount: 1 }) },
    audit: { record: async () => {}, list: async () => [] },
    trendyol: { configured: () => false },
    hepsiburada: { configured: () => true },
  };
}

test("Hepsiburada webhook Basic Auth configured ise korumali calisir", async () => {
  const previous = {
    hepsiburadaWebhookUsername: env.hepsiburadaWebhookUsername,
    hepsiburadaWebhookPassword: env.hepsiburadaWebhookPassword,
  };
  env.hepsiburadaWebhookUsername = "hb-webhook";
  env.hepsiburadaWebhookPassword = "webhook-password";
  try {
    const app = createApp(container());
    await request(app)
      .post("/api/public/hepsiburada/webhook")
      .send({ eventType: "ORDER_STATUS_UPDATED" })
      .expect(401);
    await request(app)
      .post("/api/public/hepsiburada/webhook")
      .auth("hb-webhook", "webhook-password")
      .send({ eventType: "ORDER_STATUS_UPDATED" })
      .expect(200);
  } finally {
    Object.assign(env, previous);
  }
});
