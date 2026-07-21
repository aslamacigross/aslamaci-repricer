const express = require("express");
const helmet = require("helmet");
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
  app.use(
    requestContext,
    cors,
    express.json({ limit: "2mb" }),
    createRateLimiter({ max: env.nodeEnv === "development" ? 1000 : 180 }),
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
