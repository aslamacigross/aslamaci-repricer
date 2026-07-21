const { defineConfig } = require("vite");
const path = require("path");
module.exports = defineConfig({
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, "../dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/version": "http://localhost:3000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: [path.resolve(__dirname, "src/test/setup.js")],
    include: [path.resolve(__dirname, "src/**/*.test.{js,jsx}")],
    css: true,
  },
});
