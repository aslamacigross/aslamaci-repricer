const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evidenceFromResponse,
  verifyCommissionEvidence,
  MAX_AGE_MS,
} = require("../../src/domain/hepsiburada-commission-evidence");
const {
  HepsiburadaService,
} = require("../../src/services/hepsiburada.service");
const { env } = require("../../src/config/env");
const scope = {
  merchantId: "test-merchant",
  merchantSku: "86O50O7117229",
  hbSku: "HBCV-EXACT",
};
const product = {
  marketplace: "HEPSIBURADA",
  merchant_sku: scope.merchantSku,
  hb_sku: scope.hbSku,
  commission_rate: 17,
};
const now = Date.parse("2026-11-17T10:00:00Z");
const row = () => ({
  sku: scope.hbSku,
  merchantSku: scope.merchantSku,
  merchantId: scope.merchantId,
  commissionRate: 17,
  commissionVatIncluded: true,
});
const proof = () =>
  evidenceFromResponse({ data: { items: [row()] } }, scope, now);
const verify = (e, p = product, t = now) =>
  verifyCommissionEvidence(e, p, scope.merchantId, t);
test("exact merchant-scoped provider proof matches the unchanged percentage model", () => {
  const result = verify(proof());
  assert.equal(result.rate, 17);
  assert.equal(result.vatBasis, "INCLUDED");
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.checkedAt, new Date(now).toISOString());
});
test("an authenticated merchant GET plus exact HB SKU needs no invented seller alias", () => {
  const r = row();
  delete r.merchantId;
  delete r.merchantSku;
  assert.equal(
    verify(evidenceFromResponse([r], scope, now)).merchantSku,
    scope.merchantSku,
  );
});
for (const [name, change] of [
  [
    "merchant",
    (r) => {
      r.merchantId = "other-merchant";
    },
  ],
  [
    "merchant SKU",
    (r) => {
      r.merchantSku = "8605007117229";
    },
  ],
  [
    "HB SKU",
    (r) => {
      r.sku = "HBCV-OTHER";
    },
  ],
  [
    "conflicting HB SKU aliases",
    (r) => {
      r.hbSku = "HBCV-OTHER";
    },
  ],
])
  test(`provider ${name} mismatch is rejected`, () => {
    const r = row();
    change(r);
    assert.throws(() => evidenceFromResponse([r], scope, now), {
      code: "HB_FLOOR_COMMISSION_IDENTITY_UNVERIFIED",
    });
  });
for (const rate of [
  null,
  undefined,
  "",
  "  ",
  "17%",
  -1,
  0,
  100,
  NaN,
  Infinity,
])
  test(`missing/invalid rate ${String(rate)} is not inferred`, () => {
    const r = row();
    r.commissionRate = rate;
    assert.throws(() => evidenceFromResponse([r], scope, now), {
      code: "HB_FLOOR_COMMISSION_UNVERIFIED",
    });
  });
test("duplicate and conflicting rows are not silently resolved", () => {
  assert.throws(() => evidenceFromResponse([row(), row()], scope, now), {
    code: "HB_FLOOR_COMMISSION_AMBIGUOUS",
  });
  const r = row();
  r.commission_rate = 20;
  assert.throws(() => evidenceFromResponse([r], scope, now), {
    code: "HB_FLOOR_COMMISSION_UNVERIFIED",
  });
});
test("a generic product VAT value is not commission VAT evidence", () => {
  const r = row();
  delete r.commissionVatIncluded;
  r.vat = 20;
  const e = evidenceFromResponse([r], scope, now);
  assert.equal(e.vatBasis, "UNKNOWN");
  assert.throws(() => verify(e), {
    code: "HB_FLOOR_COMMISSION_VAT_UNVERIFIED",
  });
});
test("exclusive commission is not grossed up or offset by an assumed VAT credit", () => {
  const r = row();
  r.commissionVatIncluded = false;
  assert.throws(() => verify(evidenceFromResponse([r], scope, now)), {
    code: "HB_FLOOR_COMMISSION_VAT_UNVERIFIED",
  });
});
test("conflicting or loosely typed VAT flags fail closed", () => {
  for (const extra of [
    { commissionRateIncludesVat: false },
    { commissionVatIncluded: "true" },
  ])
    assert.throws(
      () => evidenceFromResponse([{ ...row(), ...extra }], scope, now),
      { code: "HB_FLOOR_COMMISSION_VAT_UNVERIFIED" },
    );
});
test("expired/future/invalid evidence cannot authorize a floor", () => {
  for (const checkedAt of [
    new Date(now - MAX_AGE_MS - 1).toISOString(),
    new Date(now + 1).toISOString(),
    "invalid",
  ])
    assert.throws(() => verify({ ...proof(), checkedAt }), {
      code: "HB_FLOOR_COMMISSION_STALE",
    });
});
test("changed stored rate is a conflict, never a silent substitution", () => {
  assert.throws(() => verify(proof(), { ...product, commission_rate: 18 }), {
    code: "HB_FLOOR_COMMISSION_CHANGED",
  });
});
test("a refreshed identical proof keeps its economic fingerprint", () => {
  assert.equal(
    verify(proof()).fingerprint,
    verify(
      { ...proof(), checkedAt: new Date(now + 1000).toISOString() },
      product,
      now + 1000,
    ).fingerprint,
  );
});
test("proof cannot be reused for another product, marketplace or configured merchant", () => {
  for (const p of [
    { ...product, merchant_sku: "other" },
    { ...product, hb_sku: "other" },
    { ...product, marketplace: "TRENDYOL" },
  ])
    assert.throws(() => verify(proof(), p), {
      code: "HB_FLOOR_COMMISSION_IDENTITY_UNVERIFIED",
    });
  assert.throws(
    () => verifyCommissionEvidence(proof(), product, "other", now),
    { code: "HB_FLOOR_COMMISSION_IDENTITY_UNVERIFIED" },
  );
  assert.throws(() => verify({ ...proof(), source: "PRODUCT_COLUMN" }), {
    code: "HB_FLOOR_COMMISSION_UNVERIFIED",
  });
});
test("strict reader only uses an exact SKU merchant-scoped GET; no pricing POST", async () => {
  const previous = env.hepsiburadaMerchantId;
  env.hepsiburadaMerchantId = scope.merchantId;
  const api = new HepsiburadaService({ environment: "sit" });
  const calls = [];
  api.request = async (url, options) => {
    calls.push({ url, options });
    return [row()];
  };
  try {
    const e = await api.readCommissionForPrice(scope);
    assert.equal(e.source, "HEPSIBURADA_COMMISSION_API");
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.includes(
        "/commissions/merchantid/test-merchant?skuList=HBCV-EXACT",
      ),
    );
    assert.equal(calls[0].options?.method, undefined); // request defaults to GET
    await assert.rejects(
      api.readCommissionForPrice({ ...scope, hbSku: " HBCV-EXACT" }),
      { code: "HB_FLOOR_COMMISSION_IDENTITY_UNVERIFIED" },
    );
    assert.equal(calls.length, 1);
  } finally {
    env.hepsiburadaMerchantId = previous;
  }
});
