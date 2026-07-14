const TURKISH_MAP = {
  ı: "i",
  İ: "i",
  ş: "s",
  Ş: "s",
  ğ: "g",
  Ğ: "g",
  ü: "u",
  Ü: "u",
  ö: "o",
  Ö: "o",
  ç: "c",
  Ç: "c",
};

const STOP_WORDS = new Set([
  "adet",
  "avantajli",
  "boy",
  "ile",
  "paket",
  "set",
  "toplam",
  "urun",
  "ve",
  "x",
  "yikama",
]);

const TOKEN_ALIASES = {
  cik: "cikolata",
  cikolatasi: "cikolata",
  det: "deterjani",
  deterj: "deterjani",
  dolg: "dolgulu",
  edp: "parfum",
  konst: "konsantre",
  mak: "makinesi",
  parfumu: "parfum",
  tem: "temizleyici",
  yum: "yumusatici",
  yuz: "yuzey",
};

const TOKEN_EXPANSIONS = {
  dubai: ["antep", "kadayif", "dolgulu"],
};

function normalizeText(value) {
  return String(value || "")
    .replace(/[ıİşŞğĞüÜöÖçÇ]/g, (letter) => TURKISH_MAP[letter])
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " ve ")
    .replace(/([a-z])[.,]+(?=[a-z]|\s|$)/g, "$1 ")
    .replace(/[^a-z0-9.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPackCount(value) {
  const text = normalizeText(value);
  const patterns = [
    /\b(\d+(?:[.,]\d+)?)\s*(?:adet|paket)\b/,
    /\b(\d+(?:[.,]\d+)?)\s*x\s*\d+(?:[.,]\d+)?\s*(?:ml|lt|l|gr|g|kg)\b/,
    /\b\d+(?:[.,]\d+)?\s*(?:ml|lt|l|gr|g|kg)\s*x\s*(\d+(?:[.,]\d+)?)\s*(?:adet|paket)?\b/,
    /\b(\d+)\s*(?:li|lu)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = Number(String(match[1]).replace(",", "."));
    if (Number.isFinite(count) && count > 0 && count <= 1000) return count;
  }
  return 1;
}

function extractSizes(value) {
  const text = normalizeText(value);
  const sizes = [];
  const pattern = /\b(\d+(?:[.,]\d+)?)\s*(ml|lt|l|gr|g|kg)\b/g;
  for (const match of text.matchAll(pattern)) {
    const amount = Number(match[1].replace(",", "."));
    const rawUnit = match[2];
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const mass = rawUnit === "g" || rawUnit === "gr" || rawUnit === "kg";
    const baseValue =
      rawUnit === "kg" || rawUnit === "l" || rawUnit === "lt"
        ? amount * 1000
        : amount;
    sizes.push({ value: baseValue, unit: mass ? "g" : "ml" });
  }
  return sizes;
}

function tokens(value) {
  const packCount = extractPackCount(value);
  return normalizeText(value)
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(?:ml|lt|l|gr|g|kg|adet|paket|li|lu|yikama)\b/g,
      " ",
    )
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
    .split(/\s+/)
    .flatMap((token) =>
      TOKEN_EXPANSIONS[token]
        ? TOKEN_EXPANSIONS[token]
        : [TOKEN_ALIASES[token] || token],
    )
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .filter((token) => token !== String(packCount));
}

function diceCoefficient(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  return (2 * overlap) / (a.size + b.size);
}

function sameSize(left, right) {
  const a = extractSizes(left)[0];
  const b = extractSizes(right)[0];
  if (!a || !b) return null;
  return (
    a.unit === b.unit &&
    Math.abs(a.value - b.value) <= Math.max(a.value, b.value) * 0.03
  );
}

function compareProducts(target, candidate) {
  const targetTokens = tokens(target.product_name || target.item_name);
  const candidateTokens = tokens(candidate.product_name || candidate.item_name);
  const tokenScore = diceCoefficient(targetTokens, candidateTokens);
  let score = tokenScore * 0.68;
  const reasons = [
    { code: "NAME_SIMILARITY", value: Number(tokenScore.toFixed(4)) },
  ];

  const targetBrand = normalizeText(target.brand);
  const candidateBrand = normalizeText(candidate.brand);
  if (targetBrand && candidateBrand) {
    if (targetBrand === candidateBrand) {
      score += 0.12;
      reasons.push({ code: "BRAND_MATCH" });
    } else {
      score -= 0.1;
      reasons.push({ code: "BRAND_MISMATCH" });
    }
  }

  const sizeMatch = sameSize(
    target.product_name || target.item_name,
    candidate.product_name || candidate.item_name,
  );
  if (sizeMatch === true) {
    score += 0.12;
    reasons.push({ code: "SIZE_MATCH" });
  } else if (sizeMatch === false) {
    score -= 0.12;
    reasons.push({ code: "SIZE_MISMATCH" });
  }

  if (
    target.category_id &&
    candidate.category_id &&
    String(target.category_id) === String(candidate.category_id)
  ) {
    score += 0.08;
    reasons.push({ code: "CATEGORY_MATCH" });
  }

  return {
    score: Math.max(0, Math.min(1, Number(score.toFixed(5)))),
    reasons,
    targetPackCount: extractPackCount(target.product_name || target.item_name),
    candidatePackCount: extractPackCount(
      candidate.product_name || candidate.item_name,
    ),
  };
}

function scaleRecipe(sourceProduct, targetProduct, recipe) {
  const sourcePack = extractPackCount(sourceProduct.product_name);
  const targetPack = extractPackCount(targetProduct.product_name);
  const scale = sourcePack > 0 && targetPack > 0 ? targetPack / sourcePack : 1;
  return recipe.map((item) => ({
    ...item,
    quantity: Number((Number(item.quantity) * scale).toFixed(4)),
  }));
}

function confidenceBand(score) {
  if (score >= 0.92) return "HIGH";
  if (score >= 0.7) return "REVIEW";
  return "LOW";
}

module.exports = {
  normalizeText,
  extractPackCount,
  extractSizes,
  tokens,
  diceCoefficient,
  compareProducts,
  scaleRecipe,
  confidenceBand,
};
