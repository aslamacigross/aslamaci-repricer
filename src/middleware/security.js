const crypto = require("crypto");
const { env } = require("../config/env");
const { AppError } = require("../utils/errors");

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [
          decodeURIComponent(part.slice(0, index)),
          decodeURIComponent(part.slice(index + 1)),
        ];
      }),
  );
}

function securityHeaders(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
  });
  next();
}

function requestContext(req, res, next) {
  req.id = req.get("x-request-id") || crypto.randomUUID();
  res.set("x-request-id", req.id);
  next();
}

function cors(req, res, next) {
  const origin = req.get("origin");
  const allowed = env.allowedOrigin
    ? env.allowedOrigin.split(",").map((x) => x.trim())
    : [];
  if (
    origin &&
    (allowed.includes(origin) ||
      origin === `${req.protocol}://${req.get("host")}`)
  ) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Credentials", "true");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
    res.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS",
    );
  } else if (origin && env.nodeEnv === "production")
    return next(new AppError("Origin izinli değil", 403, "ORIGIN_DENIED"));
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
}

function createRateLimiter({
  windowMs = 60000,
  max = 120,
  keyPrefix = "api",
} = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}`;
    const now = Date.now();
    const current = buckets.get(key);
    const bucket =
      !current || current.reset < now
        ? { count: 0, reset: now + windowMs }
        : current;
    bucket.count++;
    buckets.set(key, bucket);
    res.set("X-RateLimit-Remaining", String(Math.max(max - bucket.count, 0)));
    if (bucket.count > max)
      return next(
        new AppError(
          "Çok fazla istek. Lütfen kısa süre sonra tekrar deneyin.",
          429,
          "RATE_LIMITED",
        ),
      );
    if (buckets.size > 10000)
      for (const [item, value] of buckets)
        if (value.reset < now) buckets.delete(item);
    next();
  };
}

function authRequired(authService) {
  return (req, res, next) => {
    const token = parseCookies(req.get("cookie") || "").aslamaci_session;
    const session = authService.verify(token);
    if (!session)
      return next(new AppError("Oturum gerekli", 401, "UNAUTHORIZED"));
    req.user = { username: session.sub };
    req.session = session;
    next();
  };
}

function csrfRequired(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-csrf-token") !== req.session?.csrf)
    return next(
      new AppError("Güvenlik doğrulaması başarısız", 403, "CSRF_FAILED"),
    );
  next();
}

function sessionCookie(token) {
  const secure = env.nodeEnv === "production" ? "; Secure" : "";
  return `aslamaci_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`;
}

function clearSessionCookie() {
  return "aslamaci_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
}

module.exports = {
  parseCookies,
  securityHeaders,
  requestContext,
  cors,
  createRateLimiter,
  authRequired,
  csrfRequired,
  sessionCookie,
  clearSessionCookie,
};
