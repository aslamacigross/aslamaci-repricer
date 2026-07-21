const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { publicationRoutes } = require("../../src/routes/publication.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

function appWith(publication) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { username: "admin" };
    req.id = "publication-test";
    next();
  });
  app.use(
    "/api",
    publicationRoutes({ publication, audit: { record: async () => {} } }),
  );
  app.use(errorHandler);
  return app;
}

test("yayın önizlemesi mutation yapmadan dry-run döner", async () => {
  const app = appWith({
    buildPreview: async () => ({
      dryRun: true,
      mutationPerformed: false,
      blockers: [],
    }),
  });
  const response = await request(app)
    .post("/api/publication-drafts/preview")
    .send({ recipeId: 1, targetMarketplace: "TRENDYOL" });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.dryRun, true);
  assert.equal(response.body.data.mutationPerformed, false);
});

test("dry-run yayın açık onayı servise iletir", async () => {
  const calls = [];
  const app = appWith({
    publishDryRun: async (...args) => {
      calls.push(args);
      return {
        draft: { id: 5, target_marketplace: "TRENDYOL" },
        result: { mutationPerformed: false },
      };
    },
  });
  const response = await request(app)
    .post("/api/publication-drafts/5/publish-dry-run")
    .send({ confirmation: "YAYIN_DRY_RUN_ONAYLA" });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], ["5", "admin", "YAYIN_DRY_RUN_ONAYLA"]);
  assert.equal(response.body.data.result.mutationPerformed, false);
});
