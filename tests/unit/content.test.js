const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSourceFacts,
  draftFromFacts,
  validateContent,
  contentDiff,
  assessListingHealth,
} = require("../../src/domain/content");

function menekseRecipe(quantity = 4) {
  return {
    id: 1,
    recipe_name: `Actisoft Menekşe Çamaşır Yumuşatıcısı 1,5 L x ${quantity}`,
    recipe_type: "PACK",
    components: [
      {
        cost_item_code: "ACTISOFT_MENEKSE_1500",
        product_name: "Menekşe Çamaşır Yumuşatıcısı",
        brand: "Actisoft",
        product_family: "Çamaşır Yumuşatıcısı",
        variant: "Menekşe",
        volume_ml: 1500,
        quantity,
      },
    ],
  };
}

test("Menekşe 1,5 L x 4 içerik taslağı gerçek paket adedini korur", () => {
  const facts = buildSourceFacts(menekseRecipe(4), "TRENDYOL");
  const draft = draftFromFacts(facts);
  assert.equal(facts.packageCount, 4);
  assert.match(draft.title, /1,5 L x 4/);
  assert.match(draft.visualBriefs[0].brief, /4 gerçek paket/);
  assert.equal(validateContent(draft, facts).errors.length, 0);
});

test("yanlış paket adedi ve uydurma sağlık iddiası içerik onayını engeller", () => {
  const facts = buildSourceFacts(menekseRecipe(4), "TRENDYOL");
  const invalid = {
    title: "Actisoft Menekşe 1,5 L x 2",
    description: "Kesin sonuç ve tedavi eder.",
    bulletPoints: [],
    visualBriefs: [],
    metadata: { packageCount: 2 },
  };
  const result = validateContent(invalid, facts);
  assert.ok(result.errors.includes("PACKAGE_COUNT_MISMATCH"));
  assert.ok(
    result.errors.some((item) => item.startsWith("UNSUPPORTED_CLAIM:")),
  );
});

test("içerik diff mevcut ve önerilen değerleri alan bazında ayırır", () => {
  const result = contentDiff(
    { title: "Eski", images: ["a"] },
    { title: "Yeni", images: ["a"] },
  );
  assert.deepEqual(result, [
    { field: "title", current: "Eski", proposed: "Yeni" },
  ]);
});

test("listing sağlık puanı sorunu, kanıtı, öneriyi ve ölçülecek KPI'yı açıklar", () => {
  const result = assessListingHealth(
    {
      title: "Menekşe Yumuşatıcı",
      description: "Kısa",
      attributes: {},
      images: [],
      video: null,
      stock: 0,
      sale_price_minor: 40000,
      buybox_price_minor: 30000,
    },
    menekseRecipe(4),
  );
  assert.ok(result.score < 50);
  const pack = result.checks.find((item) => item.code === "PACK_COUNT_MISSING");
  assert.equal(pack.status, "ISSUE");
  assert.ok(pack.evidence.expected === 4);
  assert.ok(pack.recommendation);
  assert.ok(pack.kpi);
});
