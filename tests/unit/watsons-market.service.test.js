const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  WatsonsMarketService,
  parseWatsonsPage,
  productRow,
} = require("../../src/services/watsons-market.service");

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
const firstPage = fixture("watsons-catalog-page-1.html");
const secondPage = fixture("watsons-catalog-page-2.html");

function response(body, { status = 200, statusText = "OK", headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    text: async () => String(body),
  };
}

function service(fetchImpl, overrides = {}) {
  return new WatsonsMarketService({
    catalogUrl: "https://watsons.test/tum-urunler/c/50110",
    fetchImpl,
    requestDelayMs: 0,
    sleep: async () => {},
    now: () => new Date("2026-09-29T10:00:00.000Z"),
    log: { info() {}, warn() {} },
    ...overrides,
  });
}

test("Watsons JSON-LD ürünlerini SKU seviyesinde parse eder", () => {
  const page = parseWatsonsPage(firstPage, {
    observedAt: "2026-09-29T10:00:00.000Z",
  });
  assert.equal(page.total, 3);
  assert.equal(page.lastPage, 1);
  assert.equal(page.rows.length, 2);
  assert.equal(page.rows[0].source_key, "watsons-web:BP_1319563");
  assert.equal(
    page.rows[0].product_name,
    "NYX Professional Makeup Bare With Me Kapatıcı Serum 02 Light 9,6 ml",
  );
  assert.equal(page.rows[0].brand, "NYX");
  assert.equal(page.rows[0].current_price, 1049.9);
  assert.equal(page.rows[0].availability, "AVAILABLE");
  assert.equal(page.rows[1].availability, "UNAVAILABLE");
  assert.equal(page.rows[0].raw_data.watsons_club_price, null);
  assert.equal(page.rows[0].raw_data.effective_price_type, "PUBLIC_OFFER");
});

test("Watsons katalog JSON-LD kaynağını diğer structured-data scriptlerinden ayırır", () => {
  const breadcrumb =
    '<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>';
  const page = parseWatsonsPage(firstPage.replace("<head>", `<head>${breadcrumb}`));
  assert.equal(page.rows.length, 2);
  assert.equal(page.rows[0].source_key, "watsons-web:BP_1319563");
});

test("Watsons benzer isimli renk varyantlarını BP kimliğiyle ayrı tutar", () => {
  const base = {
    name: "Marka Ruj 01 Kırmızı",
    brand: { name: "Marka" },
    offers: {
      price: "199.90",
      availability: "https://schema.org/InStock",
    },
  };
  const red = productRow({ ...base, url: "https://watsons.test/ruj/p/BP_100" });
  const pink = productRow({
    ...base,
    name: "Marka Ruj 02 Pembe",
    url: "https://watsons.test/ruj/p/BP_101",
  });
  assert.notEqual(red.source_key, pink.source_key);
  assert.match(red.product_name, /01 Kırmızı/);
  assert.match(pink.product_name, /02 Pembe/);
});

test("Watsons aynı upstream BP kimliği fiyat değişse de aynı source_key üretir", () => {
  const first = productRow({
    name: "Marka Ürün",
    url: "https://watsons.test/urun/p/BP_42",
    offers: { price: "100", availability: "https://schema.org/InStock" },
  });
  const changed = productRow({
    name: "Marka Ürün",
    url: "https://watsons.test/urun/p/BP_42",
    offers: { price: "90", availability: "https://schema.org/InStock" },
  });
  assert.equal(first.source_key, changed.source_key);
  assert.notEqual(first.current_price, changed.current_price);
});

test("Watsons eksik veya malformed public offer fiyatını kabul etmez", () => {
  assert.equal(
    productRow({
      name: "Marka Ürün",
      url: "https://watsons.test/urun/p/BP_42",
      offers: { price: "bozuk", availability: "https://schema.org/InStock" },
    }),
    null,
  );
});

test("Watsons tüm sayfaları ve final sayfayı tamamlayınca full snapshot üretir", async () => {
  const result = await service(async (url) =>
    response(new URL(url).searchParams.get("currentPage") === "1" ? secondPage : firstPage),
  ).livePriceRows();
  assert.equal(result.rows.length, 3);
  assert.equal(result.fullSnapshot, true);
  assert.equal(result.stats.pagesFetched, 2);
});

test("Watsons explicit sıfır ürünlü terminal katalog tam snapshot olabilir", async () => {
  const empty = firstPage
    .replace("3 ürün bulundu", "0 ürün bulundu")
    .replace(/<a href=[\s\S]*?<\/a>/, "")
    .replace(/\{\"@type\":\"ListItem\"[\s\S]*?\}\]\}\]\}/, "");
  const html = `<!doctype html><span>0 ürün bulundu</span><script id="json-ld" type="application/ld+json">{"@graph":[{"@type":"CollectionPage","name":"Tüm Ürünler"},{"@type":"ItemList","itemListElement":[]}]}</script>`;
  assert.ok(empty);
  const result = await service(async () => response(html)).livePriceRows();
  assert.equal(result.rows.length, 0);
  assert.equal(result.fullSnapshot, true);
});

test("Watsons duplicate sonuçları tek source_key tutar ve eksik traversal sayar", async () => {
  const duplicate = secondPage.replace(/BP_141281/g, "BP_1319563");
  const result = await service(async (url) =>
    response(new URL(url).searchParams.get("currentPage") === "1" ? duplicate : firstPage),
  ).livePriceRows();
  assert.equal(result.rows.length, 2);
  assert.equal(result.fullSnapshot, false);
});

test("Watsons partial page failure fullSnapshot üretmez", async () => {
  const result = await service(async (url) => {
    if (new URL(url).searchParams.get("currentPage") === "1")
      return response("upstream error", { status: 500, statusText: "Error" });
    return response(firstPage);
  }, { maxAttempts: 1 }).livePriceRows();
  assert.equal(result.rows.length, 2);
  assert.equal(result.fullSnapshot, false);
  assert.equal(result.stats.failedPages[0].httpStatus, 500);
});

test("Watsons 429 yanıtında Retry-After ile bounded retry uygular", async () => {
  let calls = 0;
  const onePage = firstPage
    .replace("3 ürün bulundu", "2 ürün bulundu")
    .replace(/<a href=[\s\S]*?<\/a>/, "");
  const result = await service(async () => {
    calls++;
    if (calls === 1)
      return response("slow", {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "0" },
      });
    return response(onePage);
  }).livePriceRows();
  assert.equal(calls, 2);
  assert.equal(result.fullSnapshot, true);
  assert.equal(result.stats.retryCount, 1);
});

test("Watsons 403, timeout, malformed JSON-LD ve schema hataları güvenli fail olur", async (t) => {
  await t.test("403", async () => {
    await assert.rejects(
      service(async () => response("Forbidden", { status: 403 }), {
        maxAttempts: 1,
      }).livePriceRows(),
      (error) =>
        error.code === "WATSONS_CATALOG_EMPTY" &&
        error.jobDiagnostics.httpStatus === 403,
    );
  });
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
  await t.test("malformed", async () => {
    const html = '<script id="json-ld" type="application/ld+json">{bad</script>';
    await assert.rejects(
      service(async () => response(html), { maxAttempts: 1 }).livePriceRows(),
      (error) => error.jobDiagnostics.failureStage === "parse_response",
    );
  });
  await t.test("schema", async () => {
    const html = '<script id="json-ld" type="application/ld+json">{"@graph":[]}</script>';
    await assert.rejects(
      service(async () => response(html), { maxAttempts: 1 }).livePriceRows(),
      (error) => error.jobDiagnostics.failureStage === "schema",
    );
  });
});
