const { performance } = require("node:perf_hooks");
const logger = require("../config/logger");
const {
  createRequestMetrics,
  runWithRequestMetrics,
} = require("../observability/request-metrics");

const SLOW_REQUEST_MS = 500;
const VERY_SLOW_REQUEST_MS = 2000;
const NORMAL_REQUEST_SAMPLE_RATE = 0.1;

function metricRoute(req) {
  return String(req.path || "/")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/(?=[^/]*\d)[a-z0-9_-]{12,}(?=\/|$)/gi, "/:id");
}

function requestClass(durationMs) {
  if (durationMs >= VERY_SLOW_REQUEST_MS) return "very_slow";
  if (durationMs >= SLOW_REQUEST_MS) return "slow";
  return "normal";
}

function responseBytes(res) {
  const value = Number(res.getHeader("content-length"));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function createRequestObservability({
  log = logger,
  clock = () => performance.now(),
  random = Math.random,
  normalSampleRate = NORMAL_REQUEST_SAMPLE_RATE,
} = {}) {
  return (req, res, next) => {
    if (!req.path.startsWith("/api")) return next();
    const started = clock();
    const route = metricRoute(req);
    const metrics = createRequestMetrics();
    return runWithRequestMetrics(metrics, () => {
      res.once("finish", () => {
        const durationMs = Math.max(clock() - started, 0);
        const performanceClass = requestClass(durationMs);
        const shouldLog =
          performanceClass !== "normal" ||
          res.statusCode >= 400 ||
          random() < normalSampleRate;
        if (!shouldLog) return;
        const data = {
          request_id: req.id || null,
          method: req.method,
          route,
          status: res.statusCode,
          duration_ms: Math.round(durationMs * 10) / 10,
          db_time_ms: Math.round(metrics.dbTimeMs * 10) / 10,
          query_count: metrics.queryCount,
          response_bytes: responseBytes(res),
          performance: performanceClass,
        };
        const method =
          performanceClass === "normal" && res.statusCode < 400
            ? "info"
            : "warn";
        log[method]("http_request_metric", data);
      });
      return next();
    });
  };
}

module.exports = {
  SLOW_REQUEST_MS,
  VERY_SLOW_REQUEST_MS,
  NORMAL_REQUEST_SAMPLE_RATE,
  metricRoute,
  requestClass,
  createRequestObservability,
};
