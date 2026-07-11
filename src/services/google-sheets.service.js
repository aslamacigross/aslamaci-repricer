const crypto = require("crypto");
const { env } = require("../config/env");

const RETRYABLE =
  /premature close|socket hang up|econnreset|etimedout|fetch failed|aborted|timeout/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

class GoogleSheetsService {
  constructor(options = {}) {
    this.fetch = options.fetch || global.fetch;
    this.credentials = options.credentials || null;
    this.sheetId = options.sheetId || env.googleSheetId;
    this.timeoutMs = options.timeoutMs || 15000;
    this.maxAttempts = options.maxAttempts || 4;
    this.token = null;
    this.tokenPromise = null;
    this.expiresAt = 0;
    this.failures = 0;
    this.circuitOpenUntil = 0;
  }

  getCredentials() {
    if (this.credentials) return this.credentials;
    if (!env.googleServiceAccountJson)
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON tanımlı değil");
    const parsed = JSON.parse(env.googleServiceAccountJson);
    parsed.private_key = parsed.private_key?.replace(/\\n/g, "\n");
    return parsed;
  }

  signJwt() {
    const credentials = this.getCredentials();
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({
        iss: credentials.client_email,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    );
    const unsigned = `${header}.${payload}`;
    const signature = crypto
      .createSign("RSA-SHA256")
      .update(unsigned)
      .sign(credentials.private_key);
    return `${unsigned}.${base64url(signature)}`;
  }

  async withTimeout(work, label) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await work(controller.signal);
    } catch (error) {
      if (error.name === "AbortError")
        throw new Error(`${label} timeout (${this.timeoutMs}ms)`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  isRetryable(error) {
    const status = Number(error.status || 0);
    return (
      [429, 500, 502, 503, 504].includes(status) ||
      RETRYABLE.test(error.message || "")
    );
  }

  async retry(work, label) {
    if (Date.now() < this.circuitOpenUntil)
      throw new Error(`Google Sheets circuit breaker açık: ${label}`);
    let last;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const result = await work();
        this.failures = 0;
        return result;
      } catch (error) {
        last = error;
        if (!this.isRetryable(error) || attempt === this.maxAttempts) break;
        const jitter = Math.floor(Math.random() * 250);
        await sleep(Math.min(8000, 2 ** (attempt - 1) * 500 + jitter));
      }
    }
    this.failures++;
    if (this.failures >= 3) this.circuitOpenUntil = Date.now() + 60000;
    throw last;
  }

  async getToken() {
    if (this.token && Date.now() < this.expiresAt - 300000) return this.token;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = this.retry(async () => {
      const response = await this.withTimeout(
        (signal) =>
          this.fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
              assertion: this.signJwt(),
            }),
            signal,
          }),
        "Google token",
      );
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`Google token HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const data = JSON.parse(text);
      this.token = data.access_token;
      this.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
      return this.token;
    }, "token").finally(() => {
      this.tokenPromise = null;
    });
    return this.tokenPromise;
  }

  async request(path, options = {}) {
    return this.retry(async () => {
      const token = await this.getToken();
      const response = await this.withTimeout(
        (signal) =>
          this.fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}${path}`,
            {
              method: options.method || "GET",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: options.body ? JSON.stringify(options.body) : undefined,
              signal,
            },
          ),
        "Google Sheets request",
      );
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(
          `Google Sheets HTTP ${response.status}: ${text.slice(0, 300)}`,
        );
        error.status = response.status;
        if (response.status === 401) {
          this.token = null;
          this.tokenPromise = null;
          this.expiresAt = 0;
        }
        throw error;
      }
      return text ? JSON.parse(text) : {};
    }, path);
  }

  values(range) {
    return this.request(
      `/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`,
    );
  }
  update(range, values) {
    return this.request(
      `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      { method: "PUT", body: { values } },
    );
  }
  clear(range) {
    return this.request(`/values/${encodeURIComponent(range)}:clear`, {
      method: "POST",
      body: {},
    });
  }
  metadata() {
    return this.request(
      "?fields=properties(title),sheets(properties(title,sheetId))",
    );
  }
  health() {
    return {
      configured: Boolean(this.sheetId && env.googleServiceAccountJson),
      tokenCached: Boolean(this.token),
      circuitOpen: Date.now() < this.circuitOpenUntil,
      failures: this.failures,
    };
  }
}

module.exports = { GoogleSheetsService, sleep };
