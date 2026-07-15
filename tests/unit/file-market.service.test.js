const test = require("node:test");
const assert = require("node:assert/strict");
const { FileMarketService } = require("../../src/services/file-market.service");

function response(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "FAIL",
    json: async () => body,
  };
}

test("File Market canlı sync hedef markaları kategori hariçleriyle tekilleştirir", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/v1/categories"))
      return response([
        { id: "A05", name: "Fırın Pastane" },
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

  assert.equal(calls.some((url) => url.includes("/A05/")), false);
  assert.equal(result.rows.length, 2);
  assert.equal(result.stats.categoriesSkipped, 1);
  assert.equal(result.stats.duplicates, 1);
  assert.equal(result.rows[0].source_key, "file-api:424");
  assert.equal(result.rows[0].current_price, 299);
  assert.equal(result.rows[1].brand, "Daycare");
  assert.equal(result.rows[1].availability, "UNAVAILABLE");
});
