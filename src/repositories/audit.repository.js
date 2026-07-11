class AuditRepository {
  constructor(db) {
    this.db = db;
  }

  async record(entry) {
    await this.db.query(
      `INSERT INTO audit_logs(actor, action, entity_type, entity_id, before_data, after_data, ip_address, request_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
      [
        entry.actor || "system", entry.action, entry.entityType || null, entry.entityId || null,
        JSON.stringify(entry.before || null), JSON.stringify(entry.after || null), entry.ip || null, entry.requestId || null
      ]
    );
  }

  async list({ page = 1, limit = 50, type, level }) {
    const offset = (page - 1) * limit;
    if (type === "integration") {
      const params = [];
      let where = "WHERE 1=1";
      if (level) { params.push(level); where += ` AND level = $${params.length}`; }
      params.push(limit, offset);
      return (await this.db.query(
        `SELECT id, integration AS type, level, operation AS action, message, details, created_at
         FROM integration_logs ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      )).rows;
    }
    return (await this.db.query(
      `SELECT id, 'audit' AS type, 'INFO' AS level, actor, action, entity_type, entity_id, after_data AS details, created_at
       FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]
    )).rows;
  }

  async integration(entry) {
    await this.db.query(
      `INSERT INTO integration_logs(integration, level, operation, message, details, request_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [entry.integration, entry.level || "INFO", entry.operation, entry.message, JSON.stringify(entry.details || {}), entry.requestId]
    );
  }
}

module.exports = { AuditRepository };
