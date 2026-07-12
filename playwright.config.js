const { defineConfig } = require("@playwright/test");

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: externalBaseUrl || "http://127.0.0.1:4199",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "PORT=4199 node scripts/demo-server.js",
        url: "http://127.0.0.1:4199/health",
        reuseExistingServer: true,
        timeout: 30000,
      },
});
