function normalizeCategory(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAnyCategoryPhrase(normalized, phrases) {
  return phrases.some((phrase) => {
    const current = normalizeCategory(phrase);
    return normalized === current || normalized.includes(current);
  });
}

function isShippingExcludedCategory(value) {
  const normalized = normalizeCategory(value);
  if (!normalized) return false;

  if (
    hasAnyCategoryPhrase(normalized, [
      "meyve sebze",
      "kirmizi et",
      "beyaz et",
      "et tavuk balik",
      "et tavuk sarkuteri",
      "et urunleri",
      "deniz urunleri",
      "kasap",
      "dondurma",
      "dondurulmus",
      "donuk",
      "firin pastane",
      "taze firin",
      "firindan",
      "unlu mamuller",
      "pastane ve firin urunleri",
      "acik sarkuteri",
      "taze sarkuteri",
      "acik peynirler",
    ])
  )
    return true;

  return ["meyve", "sebze", "et", "tavuk", "balik"].includes(normalized);
}

module.exports = {
  isShippingExcludedCategory,
  normalizeCategory,
};
