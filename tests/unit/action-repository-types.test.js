const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ActionRepository,
} = require("../../src/repositories/action.repository");

test("outcome pencereleri bigint aksiyon kimliği ve integer süre ile sorgulanır", async () => {
  const calls = [];
  const repository = new ActionRepository({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  });
  const actionId = "9007199254740993";

  for (const elapsedMinutes of [5, 10, 15, 60])
    await repository.pendingOutcomes(elapsedMinutes, actionId);

  assert.equal(calls.length, 4);
  for (const [index, elapsedMinutes] of [5, 10, 15, 60].entries()) {
    const call = calls[index];
    assert.match(call.sql, /\$1::text\|\|' minutes'/);
    assert.match(call.sql, /pco\.elapsed_minutes=\$2::integer/);
    assert.match(call.sql, /ra\.id=\$3::bigint/);
    assert.deepEqual(call.params, [
      String(elapsedMinutes),
      elapsedMinutes,
      actionId,
    ]);
  }
});
