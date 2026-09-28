const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  GRATIS_TOP_LEVEL_CATEGORIES,
  GratisMarketService,
  gratisPrice,
  productRow,
} = require("../../src/services/gratis-market.service");

const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8"),
  );
const firstPage = fixture("gratis-search-page-1.json");
const secondPage = fixture("gratis-search-page-2.json");

function response(body, { status = 200, statusText = "OK", headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function service(fetchImpl, overrides = {}) {
  return new GratisMarketService({
    categories: [{ id: "501", name: "Makyaj" }],
    pageSize: 2,
    fetchImpl,
    requestDelayMs: 0,
    sleep: async () => {},
    now: () => new Date("2026-09-29T10:00:00.000Z"),
    log: { info() {}, warn() {} },
    ...overrides,
  });
}

test("Gratis tam katalog geçişi doğrulanmış üst kategori kimliklerini kullanır", () => {
  assert.deepEqual(
    GRATIS_TOP_LEVEL_CATEGORIES.map((category) => category.id),
    ["501", "502", "503", "504", "505", "506", "507", "508", "509", "510", "511", "514", "515", "516"],
  );
});

test("Gratis normal online fiyatı current_price, Gratis Kart fiyatı koşullu metadata olur", () => {
  const selected = gratisPrice({
    normalPrice: 24900,
    discountedPrice: 19900,
    promotionPrice: 14900,
  });
  assert.deepEqual(selected, {
    currentPrice: 199,
    priceType: "ONLINE_SALE",
    regularPrice: 249,
    memberPrice: 149,
  });
  const row = productRow(firstPage.data[1], {
    observedAt: "2026-09-29T10:00:00.000Z",
  });
  assert.equal(row.current_price, 199);
  assert.equal(row.raw_data.gratis_card_price, 149);
  assert.equal(row.raw_data.effective_price_type, "ONLINE_SALE");
});

test("Gratis alanları stabil SKU ve varyant kimliğiyle normalize edilir", () => {
  const dewy = productRow(firstPage.data[0], {
    observedAt: "2026-09-29T10:00:00.000Z",
  });
  const matte = productRow(firstPage.data[1], {
    observedAt: "2026-09-29T10:00:00.000Z",
  });
  assert.equal(dewy.source_key, "gratis-api:10317170");
  assert.equal(dewy.brand, "LYKD");
  assert.equal(dewy.raw_data.barcode, "2050000158803");
  assert.equal(dewy.raw_data.variant_label, "Dewy");
  assert.equal(dewy.source_category, "Makyaj > Yüz Makyajı > Makyaj Sabitleyici");
  assert.equal(dewy.source_url, "https://www.gratis.com/p-10317170");
  assert.equal(dewy.availability, "AVAILABLE");
  assert.equal(matte.availability, "UNAVAILABLE");
  assert.notEqual(dewy.source_key, matte.source_key);
});

test("Gratis aynı upstream ID için aynı logical source_key üretir", () => {
  const original = productRow(firstPage.data[0]);
  const changed = productRow({
    ...firstPage.data[0],
    prices: { ...firstPage.data[0].prices, discountedPrice: 23900 },
  });
  assert.equal(original.source_key, changed.source_key);
  assert.notEqual(original.current_price, changed.current_price);
});

test("Gratis benzer isimli farklı SKU ve kardeş varyantları çökertmez", () => {
  const a = productRow({ ...firstPage.data[0], id: "A1" });
  const b = productRow({ ...firstPage.data[0], id: "B2" });
  assert.equal(a.product_name, b.product_name);
  assert.notEqual(a.source_key, b.source_key);
});

test("Gratis eksik, sıfır ve malformed fiyatı geçerli ürüne dönüştürmez", () => {
  assert.equal(
    productRow({
      ...firstPage.data[0],
      prices: { normalPrice: 0, discountedPrice: "bozuk", promotionPrice: 100 },
    }),
    null,
  );
});

test("Gratis çoklu sayfayı tamamlayınca full snapshot üretir", async () => {
  const result = await service(async (url) => {
    const data = JSON.parse(
      Buffer.from(new URL(url).searchParams.get("data"), "base64").toString(),
    );
    return response(data.query.from === 0 ? firstPage : secondPage);
  }).livePriceRows();
  assert.equal(result.rows.length, 3);
  assert.equal(result.fullSnapshot, true);
  assert.equal(result.stats.pagesFetched, 2);
  assert.equal(result.stats.completeTraversal, true);
});

test("Gratis duplicate sonuçları tek source_key olarak korur ve snapshotı eksik sayar", async () => {
  const duplicatePage = {
    ...secondPage,
    data: [{ ...firstPage.data[0] }],
  };
  const result = await service(async (url) => {
    const data = JSON.parse(
      Buffer.from(new URL(url).searchParams.get("data"), "base64").toString(),
    );
    return response(data.query.from === 0 ? firstPage : duplicatePage);
  }).livePriceRows();
  assert.equal(result.rows.length, 2);
  assert.equal(result.fullSnapshot, false);
});

test("Gratis partial pagination unseen ürünleri reconcile edecek fullSnapshot üretmez", async () => {
  const result = await service(async (url) => {
    const data = JSON.parse(
      Buffer.from(new URL(url).searchParams.get("data"), "base64").toString(),
    );
    if (data.query.from > 0)
      return response("upstream unavailable", {
        status: 503,
        statusText: "Unavailable",
      });
    return response(firstPage);
  }, { maxAttempts: 1 }).livePriceRows();
  assert.equal(result.rows.length, 2);
  assert.equal(result.fullSnapshot, false);
  assert.equal(result.stats.failedPages[0].httpStatus, 503);
});

test("Gratis 429 yanıtında bounded retry uygular", async () => {
  let calls = 0;
  const single = { ...firstPage, data: [firstPage.data[0]], itemCount: 1 };
  const result = await service(async () => {
    calls++;
    if (calls === 1)
      return response("slow down", {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "0" },
      });
    return response(single);
  }).livePriceRows();
  assert.equal(calls, 2);
  assert.equal(result.fullSnapshot, true);
  assert.equal(result.stats.retryCount, 1);
});

test("Gratis ilk sayfa 403 ise güvenli diagnostic ile fail olur", async () => {
  await assert.rejects(
    service(
      async () => response("token=secret", { status: 403, statusText: "Forbidden" }),
      { maxAttempts: 1 },
    ).livePriceRows(),
    (error) => {
      assert.equal(error.code, "GRATIS_CATALOG_EMPTY");
      assert.equal(error.jobDiagnostics.httpStatus, 403);
      assert.match(error.jobDiagnostics.responseSnippet, /\[REDACTED\]/);
      return true;
    },
  );
});

test("Gratis timeout ve malformed payload full snapshot üretmez", async (t) => {
  await t.test("timeout", async () => {
    await assert.rejects(
      service(
        (_url, { signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
        { timeoutMs: 5, maxAttempts: 1 },
      ).livePriceRows(),
      (error) => error.jobDiagnostics.failureStage === "timeout",
    );
  });
  await t.test("malformed json", async () => {
    await assert.rejects(
      service(async () => response("{not-json"), {
        maxAttempts: 1,
      }).livePriceRows(),
      (error) => error.jobDiagnostics.failureStage === "parse_response",
    );
  });
  await t.test("unexpected schema", async () => {
    await assert.rejects(
      service(async () => response({ unexpected: true }), {
        maxAttempts: 1,
      }).livePriceRows(),
      (error) => error.jobDiagnostics.failureStage === "schema",
    );
  });
});
