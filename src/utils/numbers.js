function parseNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Number(parseNumber(value).toFixed(2));
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "evet"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

module.exports = { parseNumber, roundMoney, parseBoolean };
