class MaintenanceService {
  constructor(db, retentionDays = 90) {
    this.db = db;
    this.retentionDays = retentionDays;
  }
  async cleanup() {
    const result = await this.db.query(
      `WITH deleted_audit AS(DELETE FROM audit_logs WHERE created_at<NOW()-($1||' days')::interval RETURNING 1),
      deleted_integration AS(DELETE FROM integration_logs WHERE created_at<NOW()-($1||' days')::interval RETURNING 1),
      deleted_jobs AS(DELETE FROM job_runs WHERE started_at<NOW()-($1||' days')::interval RETURNING 1)
      SELECT (SELECT COUNT(*) FROM deleted_audit)+(SELECT COUNT(*) FROM deleted_integration)+(SELECT COUNT(*) FROM deleted_jobs) AS count`,
      [this.retentionDays],
    );
    return { processed: Number(result.rows[0].count) };
  }
}
module.exports = { MaintenanceService };
