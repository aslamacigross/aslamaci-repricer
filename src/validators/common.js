const { AppError } = require("../utils/errors");

function requireFields(input, fields) {
  const missing = fields.filter(
    (field) =>
      input?.[field] === undefined ||
      input?.[field] === null ||
      input?.[field] === "",
  );
  if (missing.length)
    throw new AppError(
      `Eksik alanlar: ${missing.join(", ")}`,
      400,
      "VALIDATION_ERROR",
      missing,
    );
  return input;
}
function numeric(input, fields) {
  for (const field of fields)
    if (input[field] !== undefined && !Number.isFinite(Number(input[field])))
      throw new AppError(`${field} sayısal olmalı`, 400, "VALIDATION_ERROR");
  return input;
}
function pagination(query) {
  return {
    page: Math.max(Number(query.page) || 1, 1),
    limit: Math.min(Math.max(Number(query.limit) || 50, 1), 200),
  };
}

module.exports = { requireFields, numeric, pagination };
