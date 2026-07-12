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
  const status = error.status || 500;
  const details = {
    requestId: req.id,
    path: req.path,
    method: req.method,
    code: error.code,
    message: error.message,
    stack:
      status >= 500 && env.nodeEnv !== "production" ? error.stack : undefined,
  };
  if (status >= 500) logger.error("request_failed", details);
  else logger.warn("request_rejected", details);
  res.status(status).json({
    status: "error",
    code: error.code || "INTERNAL_ERROR",
    message: error.status ? error.message : "Beklenmeyen bir hata oluştu",
    details: error.details,
    requestId: req.id,
  });
}

module.exports = { notFound, errorHandler };
