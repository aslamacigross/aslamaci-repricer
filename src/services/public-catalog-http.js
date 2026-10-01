function safeResponseSnippet(value, limit = 180) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /(authorization|api[-_ ]?key|secret|password|token|cookie)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function catalogError(message, code, diagnostics = {}) {
  const error = new Error(message);
  error.code = code;
  error.jobDiagnostics = diagnostics;
  return error;
}

const MAX_RETRY_AFTER_MS = 30000;
const MAX_EXPONENTIAL_BACKOFF_MS = 10000;

function exponentialRetryDelay(attempt, baseDelayMs) {
  return Math.min(
    Math.max(Number(baseDelayMs) || 0, 0) * 2 ** (attempt - 1),
    MAX_EXPONENTIAL_BACKOFF_MS,
  );
}

function retryDelay(response, attempt, baseDelayMs, nowMs = Date.now()) {
  const retryAfter = response?.headers?.get?.("retry-after");
  const value = typeof retryAfter === "string" ? retryAfter.trim() : "";
  if (!value) return exponentialRetryDelay(attempt, baseDelayMs);
  const seconds = Number(value);
  if (Number.isFinite(seconds))
    return seconds >= 0
      ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
      : exponentialRetryDelay(attempt, baseDelayMs);
  const retryDate = Date.parse(value);
  if (Number.isFinite(retryDate))
    return Math.min(Math.max(retryDate - nowMs, 0), MAX_RETRY_AFTER_MS);
  return exponentialRetryDelay(attempt, baseDelayMs);
}

function policyRetryDelay(policy, context) {
  if (typeof policy !== "function") return context.defaultDelayMs;
  const selected = Number(policy(context));
  if (!Number.isFinite(selected) || selected < 0) return context.defaultDelayMs;
  return Math.min(selected, MAX_RETRY_AFTER_MS);
}

async function publicCatalogRequest({
  url,
  supplier,
  fetchImpl = fetch,
  timeoutMs = 20000,
  maxAttempts = 3,
  baseDelayMs = 500,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  headers = {},
  additionalRetryStatuses = [],
  beforeAttempt = null,
  retryDelayPolicy = null,
  responseType = "json",
}) {
  const started = Date.now();
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (typeof beforeAttempt === "function")
      await beforeAttempt({ attempt, supplier, url });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept:
            responseType === "json"
              ? "application/json"
              : "text/html,application/xhtml+xml",
          "accept-language": "tr-TR,tr;q=0.9,en;q=0.7",
          "user-agent":
            "Mozilla/5.0 (compatible; AslamaciERP-SupplierPool/1.0; +https://www.aslamaci.com)",
          ...headers,
        },
      });
      if (!response.ok) {
        let responseSnippet = "";
        try {
          responseSnippet = safeResponseSnippet(await response.text());
        } catch {
          // Status and stage remain sufficient for diagnostics.
        }
        const retryable =
          response.status === 429 ||
          response.status >= 500 ||
          additionalRetryStatuses.includes(response.status);
        const diagnostics = {
          supplier,
          failureStage: "http_response",
          httpStatus: response.status,
          statusText: safeResponseSnippet(response.statusText, 80) || null,
          responseSnippet: responseSnippet || null,
          durationMs: Date.now() - started,
          attempt,
          retryCount: attempt - 1,
        };
        const error = catalogError(
          `${supplier} katalog isteği ${response.status}: ${response.statusText || "HTTP error"}`,
          `${supplier}_HTTP_ERROR`,
          diagnostics,
        );
        if (!retryable || attempt === maxAttempts) throw error;
        lastError = error;
        const defaultDelayMs = retryDelay(response, attempt, baseDelayMs);
        await sleep(
          policyRetryDelay(retryDelayPolicy, {
            response,
            attempt,
            supplier,
            defaultDelayMs,
          }),
        );
        continue;
      }
      let body;
      try {
        body = await response.text();
      } catch (error) {
        throw catalogError(
          `${supplier} katalog yanıtı okunamadı: ${error.message}`,
          `${supplier}_RESPONSE_READ_ERROR`,
          {
            supplier,
            failureStage: "read_response",
            httpStatus: response.status,
            durationMs: Date.now() - started,
            attempt,
            retryCount: attempt - 1,
          },
        );
      }
      if (responseType === "text")
        return {
          data: body,
          retries: attempt - 1,
          durationMs: Date.now() - started,
        };
      try {
        return {
          data: JSON.parse(body),
          retries: attempt - 1,
          durationMs: Date.now() - started,
        };
      } catch (error) {
        throw catalogError(
          `${supplier} katalog yanıtı JSON olarak okunamadı: ${error.message}`,
          `${supplier}_RESPONSE_PARSE_ERROR`,
          {
            supplier,
            failureStage: "parse_response",
            httpStatus: response.status,
            responseSnippet: safeResponseSnippet(body) || null,
            durationMs: Date.now() - started,
            attempt,
            retryCount: attempt - 1,
          },
        );
      }
    } catch (error) {
      if (error.jobDiagnostics) throw error;
      const timedOut = controller.signal.aborted;
      const diagnostics = {
        supplier,
        failureStage: timedOut ? "timeout" : "network",
        httpStatus: null,
        statusText: null,
        responseSnippet: null,
        durationMs: Date.now() - started,
        attempt,
        retryCount: attempt - 1,
      };
      const wrapped = catalogError(
        timedOut
          ? `${supplier} katalog isteği zaman aşımına uğradı`
          : `${supplier} katalog isteği başarısız: ${error.message}`,
        timedOut ? `${supplier}_TIMEOUT` : `${supplier}_NETWORK_ERROR`,
        diagnostics,
      );
      if (attempt === maxAttempts) throw wrapped;
      lastError = wrapped;
      const defaultDelayMs = exponentialRetryDelay(attempt, baseDelayMs);
      await sleep(
        policyRetryDelay(retryDelayPolicy, {
          response: null,
          attempt,
          supplier,
          defaultDelayMs,
        }),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

module.exports = {
  publicCatalogRequest,
  retryDelay,
  safeResponseSnippet,
  catalogError,
};
