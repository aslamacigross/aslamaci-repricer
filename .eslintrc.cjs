module.exports = {
  root: true,
  env: { es2022: true, node: true },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["react", "react-hooks"],
  settings: { react: { version: "detect" } },
  rules: {
    "no-undef": "error",
    "no-dupe-keys": "error",
    "no-unreachable": "error",
    "no-constant-binary-expression": "error",
    "react/jsx-no-undef": "error",
    "react/jsx-key": "error",
    "react-hooks/rules-of-hooks": "error",
  },
  overrides: [
    {
      files: ["client/src/**/*.{js,jsx}"],
      env: { browser: true, node: false },
      parserOptions: { sourceType: "module" },
    },
    {
      files: ["client/vite.config.js", ".eslintrc.cjs"],
      env: { node: true },
      parserOptions: { sourceType: "script" },
    },
  ],
  ignorePatterns: ["dist/", "node_modules/", "job-application-agent/"],
};
