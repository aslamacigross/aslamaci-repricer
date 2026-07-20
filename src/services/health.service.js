class HealthService {
  constructor({ db, trendyol, hepsiburada }) {
    this.db = db;
    this.trendyol = trendyol;
    this.hepsiburada = hepsiburada;
  }

  async scan() {
    const startedAt = new Date();
    const checks = [];
    const add = (code, status, message, details = {}) =>
      checks.push({ code, status, message, details });

    try {
      await this.db.query("SELECT 1");
      add("DATABASE", "PASS", "PostgreSQL bağlantısı çalışıyor");
    } catch (error) {
      add("DATABASE", "FAIL", "PostgreSQL bağlantısı başarısız", {
        error: error.message,
      });
    }

    add(
      "TRENDYOL_CONFIGURATION",
      this.trendyol.configured() ? "PASS" : "FAIL",
      this.trendyol.configured()
        ? "Trendyol kimlik bilgileri yapılandırılmış"
        : "Trendyol kimlik bilgileri eksik",
    );
    if (!this.hepsiburada?.configured?.()) {
      add(
        "HEPSIBURADA_CONFIGURATION",
        "WARN",
        "Hepsiburada Satıcı ID veya servis anahtarı henüz tamamlanmadı",
      );
    } else {
      try {
        await this.hepsiburada.health();
        add(
          "HEPSIBURADA_CONNECTION",
          "PASS",
          "Hepsiburada read-only sipariş bağlantısı çalışıyor",
        );
      } catch (error) {
        add(
          "HEPSIBURADA_CONNECTION",
          "FAIL",
          "Hepsiburada read-only bağlantısı başarısız",
          { error: error.message },
        );
      }
    }

    const productHealth = (
      await this.db.query(
        `SELECT
           COUNT(*) FILTER(WHERE is_active) active_count,
           COUNT(*) FILTER(WHERE is_active AND NOT data_complete) incomplete_count,
           COUNT(*) FILTER(WHERE is_active AND data_status='ORPHAN_MAPPING') orphan_count,
           COUNT(*) FILTER(
             WHERE is_active AND (
               buybox_updated_at IS NULL OR buybox_updated_at<NOW()-INTERVAL '30 minutes'
             )
           ) stale_buybox_count
         FROM products WHERE marketplace='TRENDYOL'`,
      )
    ).rows[0];
    const active = Number(productHealth.active_count || 0);
    const incomplete = Number(productHealth.incomplete_count || 0);
    const orphan = Number(productHealth.orphan_count || 0);
    const staleBuybox = Number(productHealth.stale_buybox_count || 0);
    add(
      "PRODUCT_DATA",
      orphan > 0 ? "FAIL" : incomplete > 0 ? "WARN" : "PASS",
      `${active} aktif ürünün ${incomplete} tanesinde maliyet verisi eksik`,
      { active, incomplete, orphan },
    );
    add(
      "BUYBOX_FRESHNESS",
      staleBuybox > Math.max(active * 0.1, 10)
        ? "FAIL"
        : staleBuybox > 0
          ? "WARN"
          : "PASS",
      `${staleBuybox} aktif üründe buybox verisi 30 dakikadan eski`,
      { active, staleBuybox },
    );

    const supplierJobs = (
      await this.db.query(
        `SELECT j.name,
                MAX(r.finished_at) FILTER(WHERE r.status='SUCCESS') last_success,
                (ARRAY_AGG(r.status ORDER BY r.started_at DESC))[1] last_status
         FROM jobs j
         LEFT JOIN job_runs r ON r.job_name=j.name
         WHERE j.name IN(
           'sync-file-market-prices',
           'sync-bizim-market-prices',
           'sync-bim-market-prices'
         )
         GROUP BY j.name ORDER BY j.name`,
      )
    ).rows;
    for (const job of supplierJobs) {
      const ageHours = job.last_success
        ? (Date.now() - new Date(job.last_success).getTime()) / 3600000
        : Infinity;
      add(
        `SUPPLIER_${job.name.toUpperCase().replace(/-/g, "_")}`,
        ageHours > 48 ? "FAIL" : ageHours > 30 ? "WARN" : "PASS",
        job.last_success
          ? `Son başarılı çalışma ${ageHours.toFixed(1)} saat önce`
          : "Henüz başarılı çalışma yok",
        { lastSuccess: job.last_success, lastStatus: job.last_status },
      );
    }

    const failedJobs = Number(
      (
        await this.db.query(
          `SELECT COUNT(*) count FROM job_runs
           WHERE status='FAILED' AND started_at>NOW()-INTERVAL '24 hours'`,
        )
      ).rows[0].count || 0,
    );
    add(
      "FAILED_JOBS_24H",
      failedJobs > 3 ? "FAIL" : failedJobs > 0 ? "WARN" : "PASS",
      `Son 24 saatte ${failedJobs} job hatası`,
      { failedJobs },
    );

    const desiPending = Number(
      (
        await this.db.query(
          "SELECT COUNT(*) count FROM desi_review_queue WHERE status='PENDING'",
        )
      ).rows[0].count || 0,
    );
    add(
      "DESI_REVIEW_QUEUE",
      desiPending > 50 ? "WARN" : "PASS",
      `${desiPending} maliyet kaleminde desi insan kontrolü bekliyor`,
      { pending: desiPending },
    );

    const failures = checks.filter((check) => check.status === "FAIL").length;
    const warnings = checks.filter((check) => check.status === "WARN").length;
    const score = Math.max(0, 100 - failures * 20 - warnings * 5);
    const status = failures ? "CRITICAL" : warnings ? "WARNING" : "HEALTHY";
    const summary = {
      total: checks.length,
      passed: checks.filter((check) => check.status === "PASS").length,
      warnings,
      failures,
    };
    const run = (
      await this.db.query(
        `INSERT INTO health_check_runs(
           status,score,checks,summary,started_at,finished_at
         )VALUES($1,$2,$3::jsonb,$4::jsonb,$5,NOW()) RETURNING *`,
        [
          status,
          score,
          JSON.stringify(checks),
          JSON.stringify(summary),
          startedAt,
        ],
      )
    ).rows[0];
    return {
      processed: checks.length,
      successful: summary.passed,
      failed: failures,
      metadata: { status, score, warnings },
      report: run,
    };
  }

  async latest() {
    return (
      await this.db.query(
        "SELECT * FROM health_check_runs ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0];
  }

  async history(limit = 30) {
    return (
      await this.db.query(
        "SELECT * FROM health_check_runs ORDER BY created_at DESC LIMIT $1",
        [Math.min(Math.max(Number(limit) || 30, 1), 100)],
      )
    ).rows;
  }
}

module.exports = { HealthService };
