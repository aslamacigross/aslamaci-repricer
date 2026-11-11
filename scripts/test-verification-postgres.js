const { spawnSync } = require("child_process");
if (!process.env.ASLAMACI_DISPOSABLE_PG_ROOT) {
  console.error(
    "A marked disposable Unix-socket PostgreSQL instance is required; Railway URLs are never accepted.",
  );
  process.exitCode = 1;
} else {
  const environment = { ...process.env, ASLAMACI_HB_DATABASE: "postgres" };
  for (const key of [
    "DATABASE_URL",
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
  ])
    delete environment[key];
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-reporter=spec",
      "tests/integration/hepsiburada-floor-lifecycle.test.js",
      "tests/integration/price-verification-lifecycle.test.js",
    ],
    { stdio: "inherit", env: environment },
  );
  process.exitCode = result.status ?? 1;
}
