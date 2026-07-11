const logger = require("../config/logger");
const { env } = require("../config/env");

function notFound(req, res) {
  res.status(404).json({
    status: "error",
    code: "NOT_FOUND",
    message: "Kaynak bulunamadı",
    requestId: req.id,
  });
}

function errorHandler(error, req, res, next) {
  logger.error("request_failed", {
    requestId: req.id,
    path: req.path,
    method: req.method,
    code: error.code,
    message: error.message,
    stack: env.nodeEnv === "production" ? undefined : error.stack,
  });
  res.status(error.status || 500).json({
    status: "error",
    code: error.code || "INTERNAL_ERROR",
    message: error.status ? error.message : "Beklenmeyen bir hata oluştu",
    details: error.details,
    requestId: req.id,
  });
}

module.exports = { notFound, errorHandler };
