const test = require("node:test");
const assert = require("node:assert/strict");
const { JobService } = require("../../src/services/job.service");
test("advisory lock alinmazsa ayni job ikinci kez calismaz", async () => {
  let handled = 0;
  const client = {
    query: async () => ({ rows: [{ locked: false }] }),
    release() {},
  };
  const service = new JobService({
    db: { connect: async () => client },
    repository: {},
  });
  service.register("sync", async () => {
    handled++;
  });
  const result = await service.run("sync");
  assert.equal(result.status, "SKIPPED");
  assert.equal(handled, 0);
});
