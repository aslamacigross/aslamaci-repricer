const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { contentRoutes } = require("../../src/routes/content.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

function appWith(content) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { username: "admin" };
    req.id = "content-test";
    next();
  });
  app.use(
    "/api",
    contentRoutes({ content, audit: { record: async () => {} } }),
  );
  app.use(errorHandler);
  return app;
}

test("içerik taslağı endpointi açık onayı ve mutation false sonucunu taşır", async () => {
  const calls = [];
  const app = appWith({
    generate: async (...args) => {
      calls.push(args);
      return {
        draft: { id: 3, provider_mode: "MOCK_DRAFT" },
        mutationPerformed: false,
      };
    },
  });
  const response = await request(app)
    .post("/api/content-drafts/generate")
    .send({
      recipeId: 1,
      marketplace: "TRENDYOL",
      confirmation: "ICERIK_TASLAGI_URET",
    });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.mutationPerformed, false);
  assert.equal(calls[0][1], "admin");
});

test("listing sağlık taraması pazaryeri ve onayı servise iletir", async () => {
  const calls = [];
  const app = appWith({
    scanHealth: async (...args) => {
      calls.push(args);
      return { processed: 4, mutationPerformed: false };
    },
  });
  const response = await request(app).post("/api/listing-health/scan").send({
    marketplace: "HEPSIBURADA",
    confirmation: "LISTING_SAGLIGINI_TARA",
  });
  assert.equal(response.status, 201);
  assert.deepEqual(calls[0], [
    { marketplace: "HEPSIBURADA", confirmation: "LISTING_SAGLIGINI_TARA" },
    "admin",
  ]);
});
