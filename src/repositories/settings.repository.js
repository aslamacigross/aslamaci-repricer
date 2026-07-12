class SettingsRepository {
  constructor(db) {
    this.db = db;
  }

  async getAll() {
    const result = await this.db.query(
      "SELECT key, value, description, updated_by, updated_at FROM system_settings ORDER BY key",
    );
    return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  }

  async list() {
    return (
      await this.db.query(
        "SELECT key, value, description, updated_by, updated_at FROM system_settings ORDER BY key",
      )
    ).rows;
  }

  async set(key, value, actor) {
    return (
      await this.db.query(
        `INSERT INTO system_settings(key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
        [key, JSON.stringify(value), actor],
      )
    ).rows[0];
  }

  async applyServiceFeeToProducts(value) {
    return this.db.query(
      `UPDATE products SET service_fee=$1,updated_at=NOW()
       WHERE marketplace='TRENDYOL'`,
      [value],
    );
  }
}

module.exports = { SettingsRepository };
