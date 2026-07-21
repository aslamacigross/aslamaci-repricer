const { validateEnv, env } = require("./config/env");
const { pool } = require("./config/database");
const { migrate } = require("./db/migrate");
const { createContainer } = require("./container");
const { createApp } = require("./app");
const logger = require("./config/logger");

async function start() {
  validateEnv();
  if (!env.skipMigrations) await migrate("up", pool);
  const container = createContainer();
  const app = createApp(container);
  const server = app.listen(env.port, () =>
    logger.info("server_started", {
      port: env.port,
      environment: env.nodeEnv,
      dryRun: env.dryRun,
    }),
  );
  if (env.jobsEnabled) container.jobService.startScheduler();
  const shutdown = (signal) => {
    logger.info("server_stopping", { signal });
    container.jobService.stopScheduler();
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  return { app, server, container };
}
if (require.main === module || require.main?.filename?.endsWith("index.js"))
  start().catch((error) => {
    logger.error("startup_failed", {
      message: error.message,
      stack: env.nodeEnv === "production" ? undefined : error.stack,
    });
    process.exit(1);
  });
module.exports = { start };
