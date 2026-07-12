class JobRepository {
  constructor(db) {
    this.db = db;
  }

  async list() {
    return (
      await this.db.query(
        `SELECT j.*,r.status last_status,r.started_at last_started_at,r.finished_at last_finished_at,
              r.duration_ms last_duration_ms,r.processed_count last_processed_count,r.error last_error
       FROM jobs j LEFT JOIN LATERAL(SELECT * FROM job_runs WHERE job_name=j.name ORDER BY started_at DESC LIMIT 1)r ON TRUE
       ORDER BY j.name`,
      )
    ).rows;
  }

  async runs(limit = 100) {
    return (
      await this.db.query(
        "SELECT * FROM job_runs ORDER BY started_at DESC LIMIT $1",
        [Math.min(Number(limit) || 100, 500)],
      )
    ).rows;
  }

  async update(name, input) {
    return (
      await this.db.query(
        `UPDATE jobs SET schedule_minutes=COALESCE($2,schedule_minutes),
         enabled=COALESCE($3,enabled),updated_at=NOW(),
         next_run_at=CASE WHEN COALESCE($3,enabled)=TRUE
           THEN NOW()+COALESCE($2,schedule_minutes)*INTERVAL '1 minute'
           ELSE NULL END
         WHERE name=$1 RETURNING *`,
        [name, input.schedule_minutes, input.enabled],
      )
    ).rows[0];
  }

  async start(name, client = this.db) {
    const job = (await client.query("SELECT * FROM jobs WHERE name=$1", [name]))
      .rows[0];
    return (
      await client.query(
        `INSERT INTO job_runs(job_id,job_name,status) VALUES($1,$2,'RUNNING') RETURNING *`,
        [job?.id || null, name],
      )
    ).rows[0];
  }

  async finish(id, result, client = this.db) {
    const run = (
      await client.query(
        `UPDATE job_runs SET finished_at=NOW(),status=$2,duration_ms=EXTRACT(EPOCH FROM(NOW()-started_at))*1000,
       processed_count=$3,successful_count=$4,failed_count=$5,error=$6,metadata=$7::jsonb WHERE id=$1 RETURNING *`,
        [
          id,
          result.status,
          result.processed || 0,
          result.successful || 0,
          result.failed || 0,
          result.error || null,
          JSON.stringify(result.metadata || {}),
        ],
      )
    ).rows[0];
    await client.query(
      `UPDATE jobs SET last_run_at=NOW(),
       next_run_at=CASE WHEN enabled THEN NOW()+schedule_minutes*INTERVAL '1 minute' ELSE NULL END,
       updated_at=NOW() WHERE name=$1`,
      [run.job_name],
    );
    return run;
  }
}

module.exports = { JobRepository };
