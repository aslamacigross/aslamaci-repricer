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
    return (
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
  }
}

module.exports = { JobRepository };
