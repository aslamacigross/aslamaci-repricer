function parseNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Number(parseNumber(value).toFixed(2));
}

function decimalToInteger(value, decimals = 2) {
  const scale = 10n ** BigInt(decimals);
  let text = String(value ?? 0)
    .trim()
    .replace(",", ".");
  if (!/^[-+]?\d*(?:\.\d*)?(?:e[-+]?\d+)?$/i.test(text)) return 0n;
  if (/e/i.test(text)) text = Number(text).toFixed(decimals + 4);
  const negative = text.startsWith("-");
  text = text.replace(/^[-+]/, "");
  const [whole = "0", fraction = ""] = text.split(".");
  const padded = `${fraction}${"0".repeat(decimals + 1)}`;
  const kept = padded.slice(0, decimals) || "0";
  const nextDigit = Number(padded[decimals] || 0);
  let result = BigInt(whole || 0) * scale + BigInt(kept);
  if (nextDigit >= 5) result += 1n;
  return negative ? -result : result;
}

function integerToDecimal(value, decimals = 2) {
  const scale = 10n ** BigInt(decimals);
  const integer = BigInt(value);
  return Number(integer) / Number(scale);
}

function divideRounded(numerator, denominator) {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n !== denominator < 0n;
  const left = numerator < 0n ? -numerator : numerator;
  const right = denominator < 0n ? -denominator : denominator;
  const rounded = (left + right / 2n) / right;
  return negative ? -rounded : rounded;
}

function multiplyDecimals(
  left,
  right,
  { leftDecimals = 4, rightDecimals = 4, resultDecimals = 2 } = {},
) {
  const product =
    decimalToInteger(left, leftDecimals) *
    decimalToInteger(right, rightDecimals);
  const sourceDecimals = leftDecimals + rightDecimals;
  const difference = sourceDecimals - resultDecimals;
  const result =
    difference >= 0
      ? divideRounded(product, 10n ** BigInt(difference))
      : product * 10n ** BigInt(-difference);
  return integerToDecimal(result, resultDecimals);
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "evet"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

module.exports = {
  parseNumber,
  roundMoney,
  parseBoolean,
  decimalToInteger,
  integerToDecimal,
  divideRounded,
  multiplyDecimals,
};
