const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findOwnBuyboxOrder,
} = require("../../src/domain/hepsiburada-merchant-identity");
const {
  normalizeBuyboxOrders,
} = require("../../src/services/hepsiburada.service");
const own = { ownMerchantId: "merchant-A", ownSellerNames: ["AŞLAMACI GROSS"] };
function orders(rows) {
  return normalizeBuyboxOrders(
    { variants: [{ sku: "HB", buyboxOrders: rows }] },
    { strictIdentity: true },
  )[0].buyboxOrders;
}
test("current exact store name remains supported without an offer ID", () => {
  assert.equal(
    findOwnBuyboxOrder(
      orders([{ rank: 2, merchantName: " aşlamacı   gross ", price: 99 }]),
      own,
    ).rank,
    2,
  );
});
for (const name of ["Old store", "New store", ""])
  test(`verified merchant ID wins independently of display name: ${name || "missing"}`, () => {
    const rows = orders([
      { rank: 3, merchantName: name, merchantId: "MERCHANT-a", price: 99 },
    ]);
    assert.equal(findOwnBuyboxOrder(rows, own).rank, 3);
  });
test("different merchant ID vetoes even our exact store name", () => {
  assert.equal(
    findOwnBuyboxOrder(
      orders([
        {
          rank: 1,
          merchantId: "OTHER",
          merchantName: "AŞLAMACI GROSS",
          price: 99,
        },
      ]),
      own,
    ),
    null,
  );
});
test("missing both name and merchant ID stays unknown despite matching price", () => {
  assert.equal(findOwnBuyboxOrder(orders([{ rank: 1, price: 99 }]), own), null);
});
test("similar name is never an alias or a fuzzy match", () => {
  assert.equal(
    findOwnBuyboxOrder(
      orders([{ rank: 1, merchantName: "AŞLAMACI GROSS MARKET", price: 99 }]),
      own,
    ),
    null,
  );
});
test("identity without an explicit valid rank does not invent array position", () => {
  const rows = orders([{ merchantId: "merchant-a", price: 99 }]);
  assert.equal(rows[0].rank, null);
  assert.equal(rows[0].price, 99);
  assert.equal(findOwnBuyboxOrder(rows, own), null);
});
test("cargo account and customer identifiers are not merchant IDs", () => {
  assert.equal(
    findOwnBuyboxOrder(
      orders([
        {
          rank: 1,
          cargoAccountId: "merchant-a",
          customerId: "merchant-a",
          price: 99,
        },
      ]),
      own,
    ),
    null,
  );
});
test("conflicting seller and merchant IDs are unknown", () => {
  assert.equal(
    findOwnBuyboxOrder(
      orders([
        { rank: 1, merchantId: "merchant-a", sellerId: "other", price: 99 },
      ]),
      own,
    ),
    null,
  );
});
test("duplicate own identities/ranks are ambiguous", () => {
  assert.equal(
    findOwnBuyboxOrder(
      orders([
        { rank: 1, merchantId: "merchant-a", price: 99 },
        { rank: 2, merchantId: "merchant-a", price: 100 },
      ]),
      own,
    ),
    null,
  );
});
