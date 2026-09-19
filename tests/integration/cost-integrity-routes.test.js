const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const {
  costIntegrityRoutes,
} = require("../../src/routes/cost-integrity.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

test("cost integrity API Phase 2C contractini ve authenticated actor'u korur", async () => {
  const calls = [];
  const costIntegrity = {
    async legacyBackfillPreview() {
      calls.push(["legacy-preview"]);
      return { counts: { safe: 2 }, previewFingerprint: "legacy-fingerprint" };
    },
    async applyLegacyBackfill(input) {
      calls.push(["legacy-apply", input]);
      return { id: 1, status: "APPLIED" };
    },
    async preview(operationType, payload) {
      calls.push(["preview", operationType, payload]);
      return { operationType, payload, previewFingerprint: "fingerprint" };
    },
    async apply(input) {
      calls.push(["apply", input]);
      return { id: 2, status: "APPLIED" };
    },
    async reverse(id, input) {
      calls.push(["reverse", id, input]);
      return { id: 3, status: "APPLIED" };
    },
    async hardDeleteEligibility(id) {
      calls.push(["eligibility", id]);
      return { eligible: false };
    },
    async searchCostItems(query) {
      calls.push(["search", query]);
      return { items: [], total: 0 };
    },
    async costItemContext(id) {
      calls.push(["context", id]);
      return { costItem: { id: Number(id) }, mappings: [] };
    },
    async operation(id) {
      calls.push(["operation", id]);
      return { id: Number(id), status: "APPLIED" };
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { username: "authenticated-user" };
    req.id = "test-request";
    next();
  });
  app.use("/api", costIntegrityRoutes({ costIntegrity }));
  app.use(errorHandler);

  await request(app)
    .get("/api/cost-integrity/legacy-backfill/preview")
    .expect(200);
  await request(app)
    .post("/api/cost-integrity/legacy-backfill/apply")
    .send({ actor: "spoofed", reason: "approved" })
    .expect(200);
  await request(app)
    .post("/api/cost-integrity/preview")
    .send({ operationType: "ARCHIVE_COST_ITEM", payload: { costItemId: 4 } })
    .expect(200);
  await request(app)
    .post("/api/cost-integrity/apply")
    .send({ actor: "spoofed", operationType: "ARCHIVE_COST_ITEM" })
    .expect(200);
  await request(app)
    .post("/api/cost-integrity/operations/2/reverse")
    .send({ actor: "spoofed", reason: "undo" })
    .expect(200);
  await request(app)
    .get("/api/cost-integrity/cost-items/4/hard-delete-eligibility")
    .expect(200);
  await request(app).get("/api/cost-integrity/cost-items?search=tea").expect(200);
  await request(app).get("/api/cost-integrity/cost-items/4/context").expect(200);
  await request(app).get("/api/cost-integrity/operations/2").expect(200);

  assert.equal(calls[1][1].actor, "authenticated-user");
  assert.equal(calls[3][1].actor, "authenticated-user");
  assert.equal(calls[4][2].actor, "authenticated-user");
  assert.deepEqual(
    calls.map((call) => call[0]),
    [
      "legacy-preview",
      "legacy-apply",
      "preview",
      "apply",
      "reverse",
      "eligibility",
      "search",
      "context",
      "operation",
    ],
  );
});
