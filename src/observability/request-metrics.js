const { AsyncLocalStorage } = require("node:async_hooks");
const { performance } = require("node:perf_hooks");

const requestStorage = new AsyncLocalStorage();
const observedClients = new WeakMap();

function createRequestMetrics() {
  return { queryCount: 0, dbTimeMs: 0 };
}

function runWithRequestMetrics(metrics, work) {
  return requestStorage.run(metrics, work);
}

function recordDatabaseQuery(durationMs) {
  const metrics = requestStorage.getStore();
  if (!metrics) return;
  metrics.queryCount += 1;
  metrics.dbTimeMs += Number(durationMs) || 0;
}

async function measureDatabaseQuery(work) {
  const started = performance.now();
  try {
    return await work();
  } finally {
    recordDatabaseQuery(performance.now() - started);
  }
}

function observeClient(client) {
  if (!client || typeof client.query !== "function") return client;
  if (observedClients.has(client)) return observedClients.get(client);
  const observed = new Proxy(client, {
    get(target, property) {
      if (property === "query")
        return (...args) =>
          measureDatabaseQuery(() => target.query.apply(target, args));
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  observedClients.set(client, observed);
  return observed;
}

function observeDatabase(database) {
  return new Proxy(database, {
    get(target, property) {
      if (property === "query")
        return (...args) =>
          measureDatabaseQuery(() => target.query.apply(target, args));
      if (property === "connect")
        return async (...args) =>
          observeClient(await target.connect.apply(target, args));
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

module.exports = {
  createRequestMetrics,
  runWithRequestMetrics,
  recordDatabaseQuery,
  observeDatabase,
};
