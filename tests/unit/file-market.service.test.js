const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FileMarketService,
  productBrand,
} = require("../../src/services/file-market.service");

function response(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "FAIL",
    json: async () => body,
  };
}

test("File Market canlı sync tüm markaları kategori hariçleriyle tekilleştirir", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/v1/categories"))
      return response([
        { id: "A05", name: "Fırın Pastane" },
        { id: "A16", name: "Dondurma" },
        { id: "A07", name: "Temel Gıda" },
        { id: "A08", name: "Atıştırmalık" },
      ]);
    if (String(url).endsWith("/A07/subcategories"))
      return response([
        {
          id: "A0701",
          name: "Sıvı Yağlar",
          products: [
            {
              id: "p1",
              productCode: "424",
              productName: "Harras Riviera Zeytinyağı 1 lt",
              productPrice: 295,
              discountedPrice: null,
              enabled: true,
              amountUnit: "ADT",
            },
            {
              id: "p2",
              productCode: "999",
              productName: "Başka Marka Zeytinyağı",
              productPrice: 100,
              enabled: true,
              brandName: "Başka Marka",
            },
          ],
        },
        {
          id: "A0702",
          name: "Et Ürünleri",
          products: [
            {
              id: "meat",
              productCode: "MEAT",
              productName: "Dana Bonfile",
              productPrice: 500,
              enabled: true,
            },
          ],
        },
      ]);
    if (String(url).endsWith("/A08/subcategories"))
      return response([
        {
          id: "A0801",
          name: "Çikolata",
          products: [
            {
              id: "p1-dup",
              productCode: "424",
              productName: "Harras Riviera Zeytinyağı 1 lt",
              productPrice: 299,
              enabled: true,
            },
            {
              id: "p3",
              productCode: "777",
              productName: "Daycare Bioçözünür Kürdanlı Diş İpi 50'li",
              productPrice: 89,
              enabled: false,
            },
            {
              id: "p4",
              productCode: "888",
              productName: "Actisoft Yüzey Temizleyici",
              productPrice: 70,
              discountedPrice: 60,
              enabled: true,
            },
            {
              id: "p5",
              productCode: "555",
              productName: "Markasız İlk Kelime Tahmin Edilmesin",
              productPrice: 50,
              enabled: true,
            },
          ],
        },
      ]);
    assert.fail(`Beklenmeyen URL: ${url}`);
  };

  const service = new FileMarketService({
    baseUrl: "https://file.test",
    fetchImpl,
  });
  const result = await service.livePriceRows();

  assert.equal(
    calls.some((url) => url.includes("/A05/")),
    false,
  );
  assert.equal(
    calls.some((url) => url.includes("/A16/")),
    false,
  );
  assert.equal(result.rows.length, 5);
  assert.equal(result.stats.categoriesSkipped, 3);
  assert.equal(result.stats.duplicates, 1);
  assert.equal(result.rows[0].source_key, "file-api:424");
  assert.equal(result.rows[0].current_price, 299);
  assert.equal(result.rows.find((row) => row.source_key === "file-api:999").brand, "Başka Marka");
  assert.equal(result.rows.find((row) => row.source_key === "file-api:777").brand, "Daycare");
  assert.equal(
    result.rows.find((row) => row.source_key === "file-api:777").availability,
    "UNAVAILABLE",
  );
  assert.equal(result.rows.find((row) => row.source_key === "file-api:888").current_price, 60);
  assert.equal(result.rows.find((row) => row.source_key === "file-api:555").brand, "");
  assert.equal(result.stats.legacyTargetBrandProducts, 4);
});

test("File Market structured brand yoksa ilk kelimeyi marka sanmaz", () => {
  assert.equal(productBrand({ productName: "Harras Süt 1 L" }), "Harras");
  assert.equal(
    productBrand({ productName: "Sütaş Süt 1 L", brandName: "Sütaş" }),
    "Sütaş",
  );
  assert.equal(productBrand({ productName: "Sütaş Süt 1 L" }), "");
});
