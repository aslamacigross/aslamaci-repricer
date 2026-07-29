const express = require("express");
const helmet = require("helmet");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { env } = require("./config/env");
const { createContainer } = require("./container");
const {
  requestContext,
  cors,
  createRateLimiter,
  authRequired,
  csrfRequired,
} = require("./middleware/security");
const { notFound, errorHandler } = require("./middleware/error-handler");
const { asyncRoute } = require("./utils/errors");
const { authRoutes } = require("./routes/auth.routes");
const { dashboardRoutes } = require("./routes/dashboard.routes");
const { productsRoutes } = require("./routes/products.routes");
const { costsRoutes } = require("./routes/costs.routes");
const { repricerRoutes } = require("./routes/repricer.routes");
const { systemRoutes } = require("./routes/system.routes");
const { financeRoutes } = require("./routes/finance.routes");
const {
  mappingAutomationRoutes,
} = require("./routes/mapping-automation.routes");
const { APP_VERSION, REQUIRED_MIGRATION } = require("./config/version");
const { pimRoutes } = require("./routes/pim.routes");
const { publicationRoutes } = require("./routes/publication.routes");
const { opportunityRoutes } = require("./routes/opportunity.routes");
const { contentRoutes } = require("./routes/content.routes");

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuth(header = "") {
  const [scheme, encoded] = String(header).split(" ");
  if (scheme !== "Basic" || !encoded) return null;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function hepsiburadaWebhookAuth(req, res, next) {
  const expectedUsername = env.hepsiburadaWebhookUsername;
  const expectedPassword = env.hepsiburadaWebhookPassword;
  if (!expectedUsername || !expectedPassword) return next();
  const credentials = parseBasicAuth(req.headers.authorization);
  const valid =
    credentials &&
    constantTimeEqual(credentials.username, expectedUsername) &&
    constantTimeEqual(credentials.password, expectedPassword);
  if (!valid) {
    res.set("WWW-Authenticate", 'Basic realm="hepsiburada-webhook"');
    return res.status(401).json({
      status: "error",
      code: "HEPSIBURADA_WEBHOOK_UNAUTHORIZED",
    });
  }
  return next();
}

function createApp(container = createContainer()) {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  const isHeavyReadEndpoint = (req) =>
    req.method === "GET" &&
    (req.path === "/api/buybox" ||
      /^\/api\/products\/[^/]+\/image$/.test(req.path));
  app.use(
    requestContext,
    cors,
    express.json({ limit: "25mb" }),
    createRateLimiter({
      max: env.nodeEnv === "development" ? 1000 : 180,
      skip: isHeavyReadEndpoint,
    }),
  );
  app.get("/version", (req, res) =>
    res.json({
      status: "ok",
      app: "aslamaci-erp",
      version: APP_VERSION,
      dryRun: env.dryRun,
      release: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    }),
  );
  app.get(
    ["/ready", "/api/ready"],
    asyncRoute(async (req, res) => {
      const result = await container.db.query(
        "SELECT version FROM schema_migrations WHERE version=$1",
        [REQUIRED_MIGRATION],
      );
      const ready = result.rowCount === 1;
      res.status(ready ? 200 : 503).json({
        status: ready ? "ready" : "not_ready",
        database: "connected",
        requiredMigration: REQUIRED_MIGRATION,
      });
    }),
  );
  app.get(
    ["/health", "/api/health"],
    asyncRoute(async (req, res) => {
      const started = Date.now();
      await container.db.query("SELECT 1");
      res.json({
        status: "ok",
        app: "aslamaci-erp",
        version: APP_VERSION,
        database: "connected",
        responseMs: Date.now() - started,
        integrations: {
          trendyol: { configured: container.trendyol.configured() },
          hepsiburada: {
            configured: container.hepsiburada?.configured?.() || false,
          },
        },
      });
    }),
  );
  app.post(
    "/api/public/hepsiburada/webhook",
    hepsiburadaWebhookAuth,
    (req, res) =>
      res.json({
        status: "ok",
        code: "HEPSIBURADA_WEBHOOK_RECEIVED",
        message:
          "Hepsiburada SIT webhook bildirimi alindi; bu test endpointi veri degistirmez.",
        receivedAt: new Date().toISOString(),
      }),
  );
  const requireAuth = authRequired(container.auth);
  app.use(
    "/api/auth",
    authRoutes({
      auth: container.auth,
      audit: container.audit,
      requireAuth,
      requireCsrf: csrfRequired,
    }),
  );
  app.use("/api", requireAuth, csrfRequired);
  app.get(
    "/api/buybox",
    createRateLimiter({
      max: env.nodeEnv === "development" ? 2000 : 1200,
      keyPrefix: "buybox-read",
    }),
  );
  app.get(
    "/api/products/:barcode/image",
    createRateLimiter({
      max: env.nodeEnv === "development" ? 4000 : 2500,
      keyPrefix: "product-image-read",
    }),
  );
  app.use(
    "/api",
    asyncRoute(async (req, res, next) => {
      if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
      if (req.path === "/settings" || !container.settings?.getAll)
        return next();
      const current = await container.settings.getAll();
      if (current.maintenance_mode === true)
        return res.status(503).json({
          status: "error",
          code: "MAINTENANCE_MODE",
          message:
            "Sistem bakım modunda. Ayarlar dışında veri değiştiren işlemler geçici olarak durduruldu.",
        });
      return next();
    }),
  );
  app.use("/api/dashboard", dashboardRoutes(container));
  app.use("/api/products", productsRoutes(container));
  app.use("/api", costsRoutes(container));
  app.use("/api", mappingAutomationRoutes(container));
  app.use("/api", repricerRoutes(container));
  app.use("/api", financeRoutes(container));
  app.use("/api", pimRoutes(container));
  app.use("/api", publicationRoutes(container));
  app.use("/api", opportunityRoutes(container));
  app.use("/api", contentRoutes(container));
  app.use("/api", systemRoutes(container));
  const dist = path.resolve(__dirname, "../dist");
  if (fs.existsSync(dist)) {
    app.use(
      "/assets",
      express.static(path.join(dist, "assets"), {
        maxAge: env.nodeEnv === "production" ? "1y" : 0,
        immutable: env.nodeEnv === "production",
      }),
    );
    app.use(express.static(dist, { maxAge: 0, index: false }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.set("Cache-Control", "no-store");
      return res.sendFile(path.join(dist, "index.html"));
    });
  } else
    app.get("/", (req, res) =>
      res.json({
        status: "ok",
        app: "Aşlamacı ERP V2",
        message: "Frontend build bulunamadı. npm run build çalıştırın.",
      }),
    );
  app.use(notFound, errorHandler);
  return app;
}
module.exports = { createApp, APP_VERSION, REQUIRED_MIGRATION };
