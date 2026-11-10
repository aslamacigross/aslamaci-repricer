const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HepsiburadaPilotPolicy,
} = require("../../src/domain/hepsiburada-pilot");
const { testPilot } = require("../helpers/hepsiburada-pilot");
const p = {
  marketplace: "HEPSIBURADA",
  barcode: "86O50O",
  merchant_sku: "86O50O",
  hb_sku: "HBCV1",
};
for (const identity of [false, true])
  for (const floor of [false, true]) {
    test(`independent flags identity=${identity} floor=${floor}`, () => {
      const f = testPilot(p, {
        hepsiburadaStrictMerchantIdentityEnabled: identity,
        hepsiburadaFloorRecoveryEnabled: floor,
      });
      f.config.hepsiburadaPilotAllowlist[0].identity = true;
      assert.equal(f.pilot.scope(p, "identity").allowed, identity);
      assert.equal(f.pilot.scope(p, "floorRecovery").allowed, floor);
    });
  }
test("empty allowlist means no SKU, even with both global flags on", () => {
  const f = testPilot(p, {
    hepsiburadaStrictMerchantIdentityEnabled: true,
    hepsiburadaPilotAllowlist: [],
  });
  for (const feature of ["identity", "floorRecovery"])
    assert.equal(f.pilot.scope(p, feature).allowed, false);
});
for (const [label, change] of [
  ["other marketplace", (q) => (q.marketplace = "TRENDYOL")],
  ["O is not zero", (q) => (q.merchant_sku = "860500")],
  ["different HB SKU", (q) => (q.hb_sku = "HBCV2")],
  ["case-sensitive SKU", (q) => (q.hb_sku = "hbcv1")],
  [
    "missing own HB identity",
    (q) => {
      delete q.hb_sku;
    },
  ],
])
  test(`exact tuple rejects ${label}`, () => {
    const f = testPilot(p);
    const q = { ...p };
    change(q);
    assert.equal(f.pilot.scope(q, "floorRecovery").allowed, false);
  });
for (const [label, change] of [
  ["other merchant", (c) => (c.hepsiburadaMerchantId = "another")],
  ["invalid JSON", (c) => (c.hepsiburadaPilotAllowlist = "{")],
  ["missing permission", (c) => delete c.hepsiburadaPilotAllowlist[0].identity],
  [
    "string permission",
    (c) => (c.hepsiburadaPilotAllowlist[0].floorRecovery = "true"),
  ],
  [
    "duplicate tuple",
    (c) =>
      c.hepsiburadaPilotAllowlist.push({ ...c.hepsiburadaPilotAllowlist[0] }),
  ],
  [
    "more than three",
    (c) => {
      const e = c.hepsiburadaPilotAllowlist[0];
      c.hepsiburadaPilotAllowlist = Array.from({ length: 4 }, (_, i) => ({
        ...e,
        merchantSku: String(i),
      }));
    },
  ],
])
  test(`invalid configuration fails closed: ${label}`, () => {
    const f = testPilot(p);
    change(f.config);
    assert.equal(f.pilot.scope(p, "floorRecovery").allowed, false);
  });
test("identity and floor permissions can target different exact products", () => {
  const f = testPilot(p, { hepsiburadaStrictMerchantIdentityEnabled: true });
  f.config.hepsiburadaPilotAllowlist[0].identity = true;
  f.config.hepsiburadaPilotAllowlist[0].floorRecovery = false;
  f.config.hepsiburadaPilotAllowlist.push({
    ...f.config.hepsiburadaPilotAllowlist[0],
    merchantSku: "B",
    hbSku: "HBCV2",
    identity: false,
    floorRecovery: true,
  });
  assert.equal(f.pilot.scope(p, "identity").allowed, true);
  assert.equal(f.pilot.scope(p, "floorRecovery").allowed, false);
  const other = { ...p, merchant_sku: "B", hb_sku: "HBCV2" };
  assert.equal(f.pilot.scope(other, "floorRecovery").allowed, true);
  assert.equal(f.pilot.scope(other, "identity").allowed, false);
});
test("JSONB key ordering cannot invalidate identical pilot proof", () => {
  const f = testPilot(p);
  const proof = f.pilot.proof(p, { floor: true });
  const reordered = Object.fromEntries(Object.entries(proof).reverse());
  assert.doesNotThrow(() =>
    f.pilot.assertAction(
      { safety_checks: { hbPilot: reordered, hbFloorRecovery: {} } },
      p,
    ),
  );
});
test("revoking identity blocks persisted strict rank instead of treating it as legacy", () => {
  const f = testPilot(p, { hepsiburadaStrictMerchantIdentityEnabled: true });
  f.config.hepsiburadaPilotAllowlist[0].identity = true;
  const q = { ...p, buybox_source: f.pilot.identitySource(p), rank: 1 };
  const saved = f.pilot.proof(q);
  f.config.hepsiburadaStrictMerchantIdentityEnabled = false;
  assert.throws(
    () => f.pilot.assertAction({ safety_checks: { hbPilot: saved } }, q),
    { code: "HB_IDENTITY_SCOPE_REVOKED" },
  );
});
test("flag changes invalidate pending proof; floor flag does not rewrite identity observation revision", () => {
  const f = testPilot(p, { hepsiburadaStrictMerchantIdentityEnabled: true });
  f.config.hepsiburadaPilotAllowlist[0].identity = true;
  const q = { ...p, buybox_source: f.pilot.identitySource(p) };
  const saved = f.pilot.proof(q, { floor: true });
  const source = f.pilot.identitySource(q);
  f.config.hepsiburadaFloorRecoveryEnabled = false;
  assert.equal(f.pilot.identitySource(q), source);
  assert.throws(() =>
    f.pilot.assertAction(
      { safety_checks: { hbPilot: saved, hbFloorRecovery: {} } },
      q,
    ),
  );
});
test("strict pilot requires fresh provenance, not a trusted-looking legacy name", () => {
  const f = testPilot(p, { hepsiburadaStrictMerchantIdentityEnabled: true });
  f.config.hepsiburadaPilotAllowlist[0].identity = true;
  assert.throws(() => f.pilot.proof(p), { code: "HB_IDENTITY_EVIDENCE_STALE" });
});
test("default policy without configured identities denies both pilots", () => {
  const policy = new HepsiburadaPilotPolicy(() => ({}));
  assert.equal(policy.scope(p, "floorRecovery").allowed, false);
  assert.equal(policy.scope(p, "identity").allowed, false);
});

test("provider merchant identity conflict cannot grant floor permission", () => {
  const f = testPilot(p);
  assert.throws(
    () =>
      f.pilot.proof(
        { ...p, buybox_error_code: "HB_MERCHANT_IDENTITY_CONFLICT" },
        { floor: true },
      ),
    { code: "HB_MERCHANT_IDENTITY_CONFLICT" },
  );
});
test("explicit legacy manual action does not inherit or require an identity pilot grant", () => {
  const f = testPilot(p, { hepsiburadaStrictMerchantIdentityEnabled: true });
  f.config.hepsiburadaPilotAllowlist[0].identity = true;
  const q = { ...p, buybox_source: f.pilot.identitySource(p) };
  f.config.hepsiburadaPilotAllowlist = [];
  assert.equal(
    f.pilot.assertAction({ source: "MANUAL", safety_checks: {} }, q),
    null,
  );
});

test("barcode and generic platform ID cannot fill missing explicit pilot SKU identities", () => {
  const f = testPilot(p);
  assert.equal(
    f.pilot.scope({ ...p, merchant_sku: null }, "floorRecovery").allowed,
    false,
  );
  assert.equal(
    f.pilot.scope(
      { ...p, hb_sku: null, marketplace_product_id: p.hb_sku },
      "floorRecovery",
    ).allowed,
    false,
  );
});

test("own listing cannot echo a different merchant even with exact SKU strings", () => {
  const f = testPilot(p),
    proof = f.pilot.proof(p, { floor: true });
  const listing = { merchantSku: p.merchant_sku, hbSku: p.hb_sku };
  assert.equal(f.pilot.matchesListing(p, listing, proof), true);
  assert.equal(
    f.pilot.matchesListing(p, { ...listing, merchantId: "other" }, proof),
    false,
  );
  assert.equal(
    f.pilot.matchesListing(p, { ...listing, sellerId: "other" }, proof),
    false,
  );
  f.config.hepsiburadaMerchantId = "other";
  assert.equal(f.pilot.matchesListing(p, listing, proof), false);
});
