const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { opportunityRoutes } = require("../../src/routes/opportunity.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

function appWith(opportunity) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { username: "admin" };
    req.id = "opportunity-test";
    next();
  });
  app.use(
    "/api",
    opportunityRoutes({ opportunity, audit: { record: async () => {} } }),
  );
  app.use(errorHandler);
  return app;
}

test("fırsat üretme endpointi gerçek pazaryeri mutasyonu raporlamaz", async () => {
  const app = appWith({
    generate: async () => ({
      generated: 3,
      evaluated: 3,
      targetMarketplace: "TRENDYOL",
      mutationPerformed: false,
    }),
  });
  const response = await request(app).post("/api/opportunities/generate").send({
    targetMarketplace: "TRENDYOL",
    confirmation: "FIRSATLARI_URET",
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.mutationPerformed, false);
});

test("fırsat reddi neden ve açık onayı servise iletir", async () => {
  const calls = [];
  const app = appWith({
    reject: async (...args) => {
      calls.push(args);
      return {
        id: 4,
        rejection_reason: args[2].reason,
        workflow_status: "REJECTED",
      };
    },
  });
  const response = await request(app).post("/api/opportunities/4/reject").send({
    reason: "Kârlı değil",
    confirmation: "FIRSATI_REDDET",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], [
    "4",
    "admin",
    { reason: "Kârlı değil", confirmation: "FIRSATI_REDDET" },
  ]);
});
