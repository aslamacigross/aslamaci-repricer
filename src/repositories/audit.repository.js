class AuditRepository {
  constructor(db) {
    this.db = db;
  }

  async record(entry) {
    await this.db.query(
      `INSERT INTO audit_logs(actor, action, entity_type, entity_id, before_data, after_data, ip_address, request_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
      [
        entry.actor || "system",
        entry.action,
        entry.entityType || null,
        entry.entityId || null,
        JSON.stringify(entry.before || null),
        JSON.stringify(entry.after || null),
        entry.ip || null,
        entry.requestId || null,
      ],
    );
  }

  async list({ page = 1, limit = 50, type, level, search }) {
    page = Math.max(Number(page) || 1, 1);
    limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const offset = (page - 1) * limit;
    if (type === "integration") {
      const params = [];
      let where = "WHERE 1=1";
      if (level) {
        params.push(level);
        where += ` AND level = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        where += ` AND (integration ILIKE $${params.length} OR operation ILIKE $${params.length} OR message ILIKE $${params.length})`;
      }
      params.push(limit, offset);
      return (
        await this.db.query(
          `SELECT id, integration AS type, level, operation AS action, message, details, created_at
         FROM integration_logs ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        )
      ).rows;
    }
    const params = [];
    let where = "WHERE 1=1";
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (actor ILIKE $${params.length} OR action ILIKE $${params.length} OR entity_type ILIKE $${params.length} OR entity_id ILIKE $${params.length})`;
    }
    params.push(limit, offset);
    return (
      await this.db.query(
        `SELECT id, 'audit' AS type, 'INFO' AS level, actor, action, entity_type, entity_id, after_data AS details, created_at
       FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
    ).rows;
  }

  async count({ type, level, search }) {
    const params = [];
    const where = ["1=1"];
    if (type === "integration" && level) {
      params.push(level);
      where.push(`level=$${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(
        type === "integration"
          ? `(integration ILIKE $${params.length} OR operation ILIKE $${params.length} OR message ILIKE $${params.length})`
          : `(actor ILIKE $${params.length} OR action ILIKE $${params.length} OR entity_type ILIKE $${params.length} OR entity_id ILIKE $${params.length})`,
      );
    }
    const table = type === "integration" ? "integration_logs" : "audit_logs";
    return Number(
      (
        await this.db.query(
          `SELECT COUNT(*)::int count FROM ${table} WHERE ${where.join(" AND ")}`,
          params,
        )
      ).rows[0].count,
    );
  }

  async integration(entry) {
    await this.db.query(
      `INSERT INTO integration_logs(integration, level, operation, message, details, request_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        entry.integration,
        entry.level || "INFO",
        entry.operation,
        entry.message,
        JSON.stringify(entry.details || {}),
        entry.requestId,
      ],
    );
  }
}

module.exports = { AuditRepository };
