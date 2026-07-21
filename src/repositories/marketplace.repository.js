class MarketplaceRepository {
  constructor(db) {
    this.db = db;
  }

  async list() {
    return (
      await this.db.query(
        `SELECT * FROM marketplace_registry ORDER BY sort_order,display_name`,
      )
    ).rows;
  }

  async get(code) {
    return (
      await this.db.query(`SELECT * FROM marketplace_registry WHERE code=$1`, [
        String(code || "").toUpperCase(),
      ])
    ).rows[0];
  }

  async recordConnection(code, outcome) {
    return (
      await this.db.query(
        `UPDATE marketplace_registry SET
           credentials_status=$2,
           adapter_status=$3,
           last_connection_test_at=NOW(),
           last_successful_connection_at=CASE WHEN $4 THEN NOW() ELSE last_successful_connection_at END,
           last_error_code=CASE WHEN $4 THEN NULL ELSE $5 END,
           last_error_summary=CASE WHEN $4 THEN NULL ELSE $6 END,
           updated_at=NOW()
         WHERE code=$1 RETURNING *`,
        [
          code,
          outcome.credentialsStatus,
          outcome.adapterStatus,
          outcome.ok,
          outcome.errorCode || null,
          outcome.errorSummary || null,
        ],
      )
    ).rows[0];
  }
}

module.exports = { MarketplaceRepository };
