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

function retryDelay(response, attempt, baseDelayMs) {
  const retryAfter = response?.headers?.get?.("retry-after");
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, 30000);
  const retryDate = Date.parse(String(retryAfter || ""));
  if (Number.isFinite(retryDate))
    return Math.min(Math.max(retryDate - Date.now(), 0), 30000);
  return Math.min(baseDelayMs * 2 ** (attempt - 1), 10000);
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
  responseType = "json",
}) {
  const started = Date.now();
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        const retryable = response.status === 429 || response.status >= 500;
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
        await sleep(retryDelay(response, attempt, baseDelayMs));
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
      await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), 10000));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

module.exports = {
  publicCatalogRequest,
  safeResponseSnippet,
  catalogError,
};
