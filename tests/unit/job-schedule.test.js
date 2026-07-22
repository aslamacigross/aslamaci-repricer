const test = require("node:test");
const assert = require("node:assert/strict");
const { JobService, isJobDue } = require("../../src/services/job.service");

const daily = {
  enabled: true,
  schedule_type: "DAILY",
  daily_at: "00:00",
  schedule_timezone: "Europe/Istanbul",
};

test("gece tedarikci jobu Istanbul saatinden once calismaz", () => {
  assert.equal(
    isJobDue(
      { ...daily, daily_at: "00:30" },
      new Date("2026-07-20T21:29:00.000Z"),
    ),
    false,
  );
});

test("gece tedarikci jobu Istanbul saatinde gunde bir kez calisir", () => {
  const now = new Date("2026-07-20T21:01:00.000Z");
  assert.equal(isJobDue(daily, now), true);
  assert.equal(
    isJobDue({ ...daily, last_run_at: "2026-07-20T21:00:30.000Z" }, now),
    false,
  );
  assert.equal(
    isJobDue({ ...daily, last_run_at: "2026-07-19T21:00:30.000Z" }, now),
    true,
  );
});

test("scheduler due olan enabled joblari calistirir", async () => {
  const calls = [];
  const service = new JobService({
    db: {
      async query() {
        return {
          rows: [
            {
              name: "due-job",
              enabled: true,
              schedule_type: "INTERVAL",
              schedule_minutes: 1,
              last_run_at: null,
            },
            {
              name: "not-due-job",
              enabled: true,
              schedule_type: "INTERVAL",
              schedule_minutes: 10,
              last_run_at: new Date().toISOString(),
            },
          ],
        };
      },
    },
    repository: {},
  });
  service.run = async (name, metadata) => {
    calls.push({ name, metadata });
    return { status: "SUCCESS" };
  };
  const result = await service.runDueJobs();
  assert.equal(result.processed, 1);
  assert.deepEqual(calls, [
    { name: "due-job", metadata: { source: "scheduler" } },
  ]);
});
