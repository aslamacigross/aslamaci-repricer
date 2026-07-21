class AppError extends Error {
  constructor(message, status = 400, code = "BAD_REQUEST", details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function asyncRoute(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { AppError, asyncRoute };
