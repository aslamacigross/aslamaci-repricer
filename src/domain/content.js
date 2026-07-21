const crypto = require("crypto");
const { normalized } = require("./pim");

function contentChecksum(content) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(content || {}))
    .digest("hex");
}

function totalUnits(components = []) {
  return components.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function factText(component) {
  const amount = component.volume_ml
    ? `${Number(component.volume_ml) / 1000 >= 1 ? `${Number(component.volume_ml) / 1000} L` : `${component.volume_ml} ml`}`
    : component.weight_g
      ? `${component.weight_g} g`
      : "";
  return [component.product_name, component.variant, amount]
    .filter(Boolean)
    .join(" ");
}

function buildSourceFacts(recipe, marketplace) {
  const components = (recipe.components || []).map((item) => ({
    costItemCode: item.cost_item_code,
    productName: item.product_name,
    brand: item.brand,
    productFamily: item.product_family,
    variant: item.variant,
    volumeMl: item.volume_ml == null ? null : Number(item.volume_ml),
    weightG: item.weight_g == null ? null : Number(item.weight_g),
    quantity: Number(item.quantity),
  }));
  return {
    recipeId: recipe.id,
    recipeName: recipe.recipe_name,
    recipeType: recipe.recipe_type,
    marketplace,
    packageCount: totalUnits(recipe.components),
    brands: [...new Set(components.map((item) => item.brand).filter(Boolean))],
    productFamilies: [
      ...new Set(components.map((item) => item.productFamily).filter(Boolean)),
    ],
    components,
  };
}

function draftFromFacts(facts) {
  const componentLabels = facts.components.map((item) => {
    const raw = {
      product_name: item.productName,
      variant: item.variant,
      volume_ml: item.volumeMl,
      weight_g: item.weightG,
    };
    const label = factText(raw);
    return `${label}${item.quantity > 1 ? ` x ${item.quantity}` : ""}`;
  });
  const packageLabel =
    facts.packageCount > 1 ? ` - ${facts.packageCount} Parça` : "";
  const title = `${facts.recipeName}${packageLabel}`.trim();
  return {
    title,
    description: `${title}. Paket içeriği: ${componentLabels.join(", ")}. Ürün bilgileri ERP reçetesindeki doğrulanmış bileşenlerden hazırlanmıştır.`,
    bulletPoints: componentLabels.map((label) => `Paket içeriği: ${label}`),
    searchTerms: [...facts.brands, ...facts.productFamilies]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("tr-TR"),
    benefitText: "Ürün ve paket içeriği açık biçimde listelenmiştir.",
    bundleText: componentLabels.join(" + "),
    visualBriefs: [
      {
        type: "MAIN",
        brief: `${facts.packageCount} gerçek paket, sade beyaz fon, ambalaj yazıları değiştirilmeden.`,
      },
      {
        type: "PACKAGE_CONTENT",
        brief: `${componentLabels.join(" + ")} bileşimini ve adetleri eksiksiz göster.`,
      },
      {
        type: "MEASUREMENT",
        brief: "Kaynak ürün ölçülerini ve paket adedini okunaklı göster.",
      },
    ],
    videoScript: `${facts.packageCount} paketlik gerçek içeriği sırayla göster; ürün ambalajındaki iddialara yeni vaat ekleme.`,
    metadata: {
      packageCount: facts.packageCount,
      marketplace: facts.marketplace,
    },
  };
}

function contentDiff(current = {}, proposed = {}) {
  const keys = [
    ...new Set([...Object.keys(current), ...Object.keys(proposed)]),
  ];
  return keys
    .filter(
      (key) => JSON.stringify(current[key]) !== JSON.stringify(proposed[key]),
    )
    .map((key) => ({
      field: key,
      current: current[key] ?? null,
      proposed: proposed[key] ?? null,
    }));
}

function validateContent(content = {}, facts = {}) {
  const errors = [];
  const warnings = [];
  const title = String(content.title || "");
  const description = String(content.description || "");
  if (!title.trim()) errors.push("TITLE_REQUIRED");
  if (!description.trim()) errors.push("DESCRIPTION_REQUIRED");
  for (const brand of facts.brands || [])
    if (!normalized(title).includes(normalized(brand)))
      warnings.push(`BRAND_NOT_IN_TITLE:${brand}`);
  if (
    Number(facts.packageCount) > 1 &&
    !normalized(title).includes(normalized(String(facts.packageCount)))
  )
    errors.push("PACKAGE_COUNT_NOT_IN_TITLE");
  if (Number(content.metadata?.packageCount) !== Number(facts.packageCount))
    errors.push("PACKAGE_COUNT_MISMATCH");
  const combined = `${title} ${description} ${(content.bulletPoints || []).join(" ")}`;
  const unsupportedClaims = [
    "tedavi eder",
    "kesin sonuç",
    "garantili sonuç",
    "doktor onaylı",
  ];
  for (const claim of unsupportedClaims)
    if (normalized(combined).includes(normalized(claim)))
      errors.push(`UNSUPPORTED_CLAIM:${claim}`);
  if (
    !(content.visualBriefs || []).some(
      (item) => item.type === "PACKAGE_CONTENT",
    )
  )
    warnings.push("PACKAGE_CONTENT_VISUAL_BRIEF_MISSING");
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

function check(
  code,
  label,
  failed,
  penalty,
  evidence,
  recommendation,
  kpi,
  known = true,
) {
  return {
    code,
    label,
    status: !known ? "UNKNOWN" : failed ? "ISSUE" : "PASS",
    penalty: known && failed ? penalty : 0,
    evidence,
    recommendation: failed ? recommendation : null,
    expectedImpact: failed
      ? "İçerik açıklığını ve listing güvenilirliğini artırabilir"
      : null,
    kpi: failed ? kpi : null,
  };
}

function assessListingHealth(listing, recipe) {
  const components = recipe.components || [];
  const count = totalUnits(components);
  const brands = [
    ...new Set(components.map((item) => item.brand).filter(Boolean)),
  ];
  const title = String(listing.title || "");
  const description = String(listing.description || "");
  const images = Array.isArray(listing.images) ? listing.images : [];
  const attributes = listing.attributes || {};
  const checks = [
    check(
      "TITLE_MISSING",
      "Başlık",
      !title.trim(),
      15,
      title || "Başlık yok",
      "Doğrulanmış ürün adıyla başlık ekleyin",
      "listing doğrulama",
    ),
    check(
      "BRAND_MISSING",
      "Marka",
      brands.some((brand) => !normalized(title).includes(normalized(brand))),
      8,
      brands,
      "Markayı başlıkta doğru biçimde belirtin",
      "tıklanma oranı",
      brands.length > 0,
    ),
    check(
      "PACK_COUNT_MISSING",
      "Paket adedi",
      count > 1 && !normalized(title).includes(normalized(String(count))),
      12,
      { expected: count, title },
      "Toplam paket adedini başlığa ekleyin",
      "yanlış beklenti/iade",
    ),
    check(
      "DESCRIPTION_SHORT",
      "Açıklama",
      description.trim().length < 120,
      10,
      { characters: description.length },
      "Bileşen ve ölçüleri kaynak gerçekleriyle açıklayın",
      "içerik tamlığı",
    ),
    check(
      "ATTRIBUTES_MISSING",
      "Kategori özellikleri",
      Object.keys(attributes).length === 0,
      10,
      { count: Object.keys(attributes).length },
      "Zorunlu kategori özelliklerini tamamlayın",
      "listing kabulü",
    ),
    check(
      "IMAGE_COUNT_LOW",
      "Görsel sayısı",
      images.length < 3,
      15,
      { count: images.length },
      "Ana, paket içeriği ve ölçü görsellerini ekleyin",
      "görsel etkileşimi",
    ),
    check(
      "MAIN_IMAGE_MISSING",
      "Ana görsel",
      images.length === 0,
      10,
      { count: images.length },
      "Gerçek ürünü gösteren ana görsel ekleyin",
      "listing görünürlüğü",
    ),
    check(
      "VIDEO_MISSING",
      "Video",
      !listing.video,
      3,
      Boolean(listing.video),
      "Ürün ve paket içeriğini doğru gösteren video değerlendirin",
      "video etkileşimi",
    ),
    check(
      "OUT_OF_STOCK",
      "Stok sürekliliği",
      Number(listing.stock || 0) <= 0,
      10,
      { stock: listing.stock },
      "Listing stok durumunu kontrol edin",
      "stokta kalma oranı",
    ),
    check(
      "PRICE_NOT_COMPETITIVE",
      "Fiyat rekabeti",
      Number(listing.buybox_price_minor || 0) > 0 &&
        Number(listing.sale_price_minor || 0) >
          Number(listing.buybox_price_minor) * 1.05,
      7,
      { sale: listing.sale_price_minor, buybox: listing.buybox_price_minor },
      "Minimum kârı koruyarak fiyat/sıra önizlemesi yapın",
      "buybox sırası",
    ),
  ];
  const penalty = checks.reduce((sum, item) => sum + item.penalty, 0);
  const known = checks.filter((item) => item.status !== "UNKNOWN").length;
  const score = Math.max(0, 100 - penalty);
  const confidence =
    known >= 9
      ? "HIGH"
      : known >= 7
        ? "MEDIUM"
        : known >= 4
          ? "LOW"
          : "INSUFFICIENT_DATA";
  return {
    score,
    confidence,
    checks,
    dataQuality: {
      knownChecks: known,
      missing: [
        !listing.last_verified_at && "lastVerifiedAt",
        !listing.video && "video",
        "conversionRate",
        "returnRate",
        "customerQuestions",
      ].filter(Boolean),
    },
    summary: checks.filter((item) => item.status === "ISSUE").length
      ? `${checks.filter((item) => item.status === "ISSUE").length} doğrulanabilir iyileştirme alanı bulundu`
      : "Doğrulanabilir içerik kontrolleri geçti",
  };
}

module.exports = {
  contentChecksum,
  buildSourceFacts,
  draftFromFacts,
  contentDiff,
  validateContent,
  assessListingHealth,
};
