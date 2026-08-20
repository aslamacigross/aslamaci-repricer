const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeSeller,
  parseHepsiburadaPublicBuyboxHtml,
  parseTurkishPrice,
} = require("../../src/domain/hepsiburada-buybox");

const ownMerchantId = "merchant-1";
const html = (offers, extra = "") => `
  <html><body>
    <script type="mime/invalid" id="reduxStore">
      ${JSON.stringify({
        productState: {
          product: {
            sku: "HBV1",
            ...offers[0],
            allListings: offers.slice(1),
          },
        },
      })}
    </script>
    ${extra}
  </body></html>
`;

function offer({ merchantName, merchantId, price, sku = "HBV1" }) {
  return {
    sku,
    merchantName,
    merchantId,
    listingId: `${merchantId}-${price}`,
    prices: [{ value: price }],
  };
}

describe("Hepsiburada public buybox parser", () => {
  test("Buybox bizdeyse rank 1 dondurur", () => {
    const result = parseHepsiburadaPublicBuyboxHtml(
      html([
        offer({
          merchantName: "AŞLAMACI GROSS",
          merchantId: ownMerchantId,
          price: 649.9,
        }),
      ]),
      { hbSku: "HBV1", ownMerchantId },
    );
    assert.equal(result.ok, true);
    assert.equal(result.buyboxPrice, 649.9);
    assert.equal(result.rank, 1);
    assert.equal(result.buyboxSeller, "AŞLAMACI GROSS");
  });

  test("ilk alternatif bizsek rank 2 dondurur", () => {
    const result = parseHepsiburadaPublicBuyboxHtml(
      html([
        offer({ merchantName: "Rakip A", merchantId: "r-1", price: 649.9 }),
        offer({
          merchantName: "Aşlamacı Gross",
          merchantId: ownMerchantId,
          price: 654.9,
        }),
      ]),
      { hbSku: "HBV1", ownMerchantId },
    );
    assert.equal(result.rank, 2);
    assert.equal(result.secondPrice, 654.9);
  });

  test("ikinci alternatif bizsek rank 3 dondurur", () => {
    const result = parseHepsiburadaPublicBuyboxHtml(
      html([
        offer({ merchantName: "Rakip A", merchantId: "r-1", price: 649.9 }),
        offer({ merchantName: "Rakip B", merchantId: "r-2", price: 653.9 }),
        offer({
          merchantName: "Aşlamacı Gross",
          merchantId: ownMerchantId,
          price: 654.9,
        }),
      ]),
      { hbSku: "HBV1", ownMerchantId },
    );
    assert.equal(result.rank, 3);
    assert.equal(result.thirdPrice, 654.9);
  });

  test("biz ilk 3 te gorunmuyorsak rank uydurmaz", () => {
    const result = parseHepsiburadaPublicBuyboxHtml(
      html([
        offer({ merchantName: "Rakip A", merchantId: "r-1", price: 649.9 }),
        offer({ merchantName: "Rakip B", merchantId: "r-2", price: 653.9 }),
        offer({ merchantName: "Rakip C", merchantId: "r-3", price: 654.9 }),
      ]),
      { hbSku: "HBV1", ownMerchantId },
    );
    assert.equal(result.rank, null);
    assert.equal(result.buyboxPrice, 649.9);
  });

  test("tek saticili urunu coklu satici degil olarak isaretler", () => {
    const result = parseHepsiburadaPublicBuyboxHtml(
      html([
        {
          ...offer({
            merchantName: "AŞLAMACI GROSS",
            merchantId: ownMerchantId,
            price: 100,
          }),
          isMultiSeller: false,
        },
      ]),
      { hbSku: "HBV1", ownMerchantId },
    );
    assert.equal(result.hasMultipleSeller, false);
  });

  test("eksik state jobu crash ettirmeyecek parser failure dondurur", () => {
    const result = parseHepsiburadaPublicBuyboxHtml("<html></html>", {
      hbSku: "HBV1",
      ownMerchantId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "PARSE_FAILED");
  });

  test("Turkiye fiyat formatini parse eder", () => {
    assert.equal(parseTurkishPrice("1.249,90 TL"), 1249.9);
  });

  test("seller normalize case ve bosluk farklarini esler", () => {
    assert.equal(normalizeSeller("  aşlamacı   gross "), "AŞLAMACI GROSS");
    const result = parseHepsiburadaPublicBuyboxHtml(
      html([offer({ merchantName: "  aşlamacı   gross ", price: 100 })]),
      { hbSku: "HBV1", ownSellerNames: ["AŞLAMACI GROSS"] },
    );
    assert.equal(result.rank, 1);
  });

  test("HBCV listing kimligini public HBC product state ile esler", () => {
    const result = parseHepsiburadaPublicBuyboxHtml(
      html([
        offer({
          merchantName: "AŞLAMACI GROSS",
          merchantId: ownMerchantId,
          price: 100,
          sku: "HBC0000C0JK75",
        }),
      ]),
      { hbSku: "HBCV0000C0JK75", ownMerchantId },
    );
    assert.equal(result.ok, true);
    assert.equal(result.rank, 1);
    assert.equal(result.buyboxPrice, 100);
  });

  test("hedef SKU ile eslesmeyen public sayfa teklifini reddeder", () => {
    const result = parseHepsiburadaPublicBuyboxHtml(
      html([
        offer({
          merchantName: "ECIR STORE",
          merchantId: "competitor-1",
          price: 59999,
          sku: "HBCV00006M1W0B",
        }),
      ]),
      { hbSku: "HBCV00003AZK32", ownMerchantId },
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, "PARSE_FAILED");
  });

  test("hedef SKU ile eslesmeyen JSON-LD teklifini reddeder", () => {
    const result = parseHepsiburadaPublicBuyboxHtml(
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        sku: "HBCV00006M1W0B",
        offers: {
          "@type": "Offer",
          price: "59999.00",
          seller: { name: "ECIR STORE", identifier: "competitor-1" },
        },
      })}</script>`,
      { hbSku: "HBCV00003AZK32", ownMerchantId },
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, "PARSE_FAILED");
  });
});
