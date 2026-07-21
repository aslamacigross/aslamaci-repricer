const logger = require("../config/logger");

function zonedParts(date, timeZone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function isJobDue(job, now = new Date()) {
  if (!job.enabled) return false;
  if (job.schedule_type !== "DAILY")
    return (
      !job.last_run_at ||
      new Date(job.last_run_at).getTime() +
        Number(job.schedule_minutes || 1) * 60000 <=
        now.getTime()
    );
  const current = zonedParts(now, job.schedule_timezone);
  const [hour, minute] = String(job.daily_at || "00:00")
    .split(":")
    .map(Number);
  const targetMinutes = hour * 60 + minute;
  const currentMinutes = Number(current.hour) * 60 + Number(current.minute);
  if (currentMinutes < targetMinutes) return false;
  if (!job.last_run_at) return true;
  const last = zonedParts(new Date(job.last_run_at), job.schedule_timezone);
  return (
    `${last.year}-${last.month}-${last.day}` !==
    `${current.year}-${current.month}-${current.day}`
  );
}

class JobService {
  constructor({ db, repository, handlers = {} }) {
    this.db = db;
    this.repository = repository;
    this.handlers = handlers;
    this.timer = null;
  }
  register(name, handler) {
    this.handlers[name] = handler;
  }

  async run(name, metadata = {}) {
    const handler = this.handlers[name];
    if (!handler) throw new Error(`Bilinmeyen job: ${name}`);
    const client = await this.db.connect();
    let locked = false,
      run;
    try {
      const lock = await client.query(
        "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
        [`aslamaci:${name}`],
      );
      locked = Boolean(lock.rows[0].locked);
      if (!locked)
        return {
          status: "SKIPPED",
          error: "Job zaten çalışıyor",
          processed: 0,
        };
      run = await this.repository.start(name, client);
      try {
        const result = await handler(metadata);
        return await this.repository.finish(
          run.id,
          { status: "SUCCESS", ...result },
          client,
        );
      } catch (error) {
        logger.error("job_failed", { job: name, message: error.message });
        await this.repository.finish(
          run.id,
          { status: "FAILED", error: error.message },
          client,
        );
        throw error;
      }
    } finally {
      if (locked)
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
          `aslamaci:${name}`,
        ]);
      client.release();
    }
  }

  startScheduler() {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      try {
        const due = (
          await this.db.query("SELECT * FROM jobs WHERE enabled=TRUE")
        ).rows.filter((job) => isJobDue(job));
        for (const job of due) {
          try {
            await this.run(job.name, { source: "scheduler" });
          } catch {
            // JobService.run already records and logs the failure.
          }
        }
      } catch (error) {
        logger.error("scheduler_failed", { message: error.message });
      }
    }, 60000);
    this.timer.unref?.();
  }
  stopScheduler() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { JobService, isJobDue, zonedParts };
