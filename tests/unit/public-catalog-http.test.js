const test = require("node:test");
const assert = require("node:assert/strict");
const {
  publicCatalogRequest,
  retryDelay,
} = require("../../src/services/public-catalog-http");

function headers(value) {
  return { headers: { get: () => value } };
}

function response(status, retryAfter) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: () => retryAfter },
    text: async () => (status === 200 ? "{}" : "temporary"),
  };
}

test("Retry-After yalnız geçerli ve bounded olduğunda exponential backoffu değiştirir", () => {
  const now = Date.parse("2026-10-02T10:00:00.000Z");
  assert.equal(retryDelay(headers("2"), 1, 500, now), 2000);
  assert.equal(retryDelay(headers(undefined), 1, 500, now), 500);
  assert.equal(retryDelay(headers(null), 1, 500, now), 500);
  assert.equal(retryDelay(headers(""), 2, 500, now), 1000);
  assert.equal(retryDelay(headers("   "), 2, 500, now), 1000);
  assert.equal(retryDelay(headers("invalid"), 2, 500, now), 1000);
  assert.equal(retryDelay(headers("-1"), 2, 500, now), 1000);
  assert.equal(retryDelay(headers("120"), 1, 500, now), 30000);
  assert.equal(retryDelay(headers("29"), 1, 500, now), 29000);
  assert.equal(
    retryDelay(headers("Fri, 02 Oct 2026 10:00:05 GMT"), 1, 500, now),
    5000,
  );
});

test("generic helper 403 retry ve attempt pacing davranışını opt-in tutar", async () => {
  let calls = 0;
  let hooks = 0;
  await assert.rejects(
    publicCatalogRequest({
      url: "https://example.test/catalog",
      supplier: "GENERIC",
      fetchImpl: async () => {
        calls++;
        return response(403, null);
      },
      sleep: async () => {},
    }),
    (error) => error.jobDiagnostics.attempt === 1,
  );
  assert.equal(calls, 1);
  assert.equal(hooks, 0);

  calls = 0;
  const result = await publicCatalogRequest({
    url: "https://example.test/catalog",
    supplier: "OPT_IN",
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? response(403, null) : response(200, null);
    },
    additionalRetryStatuses: [403],
    beforeAttempt: async () => {
      hooks++;
    },
    sleep: async () => {},
  });
  assert.equal(result.retries, 1);
  assert.equal(calls, 2);
  assert.equal(hooks, 2);
});
