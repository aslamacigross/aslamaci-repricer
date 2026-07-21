const { PGlite } = require("@electric-sql/pglite");

function normalizeResult(result = {}) {
  const rows = result.rows || [];
  return {
    ...result,
    rows,
    rowCount: rows.length || Number(result.affectedRows || 0),
  };
}

async function createPglitePool() {
  const database = new PGlite();

  const query = async (text, params = []) => {
    if (params.length)
      return normalizeResult(await database.query(text, params));
    const results = await database.exec(text);
    return normalizeResult(results.at(-1));
  };

  return {
    query,
    async connect() {
      return { query, release() {} };
    },
    async end() {
      await database.close();
    },
  };
}

module.exports = { createPglitePool };
