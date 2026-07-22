function nextLearningRecommendation(item) {
  if (!item) return "Henüz öğrenme verisi yok; sonuç kontrolleri bekleniyor.";
  if (item.paused)
    return "Öğrenme duraklatıldı; ürün Kâr Koru yaklaşımıyla manuel incelenmeli.";
  const learned = Number(item.learned_price_cut_tl || 0);
  const successful = Number(item.last_successful_undercut || 0);
  const confidence = Number(item.confidence_score || 0);
  const attempts = Number(item.outcome_count || 0);
  const format = (value) => Number(value).toFixed(2).replace(".", ",");
  if (successful > 0)
    return `${format(successful)} TL başarılı en küçük fiyat kırmasını koru.`;
  if (Number(item.consecutive_failures || 0) >= 2 && learned > 0)
    return `${format(learned)} TL kontrollü adımı manuel onayla; başarısızlık sürerse agresifleşme.`;
  if (attempts === 0)
    return "Henüz ölçülmüş sonuç yok; önce dry-run ve manuel onayla veri topla.";
  if (confidence < 0.4)
    return "Güven skoru düşük; sonraki öneriyi otomatik değil manuel onayla.";
  return learned > 0
    ? `${format(learned)} TL öğrenilmiş fiyat adımını güvenlik sınırları içinde kullan.`
    : "Mevcut fiyatı koru ve yeni buybox sonucu topla.";
}

function actionFilter({ status, barcode, marketplace } = {}) {
  const params = [];
  const where = ["1=1"];
  if (marketplace) {
    params.push(String(marketplace).toUpperCase());
    where.push(`ra.marketplace=$${params.length}`);
  }
  if (status === "EXPIRED")
    where.push("ra.status IN('PENDING','APPROVED') AND ra.expires_at<NOW()");
  else if (status) {
    params.push(status);
    where.push(`ra.status=$${params.length}`);
  }
  if (barcode) {
    params.push(barcode);
    where.push(`ra.barcode=$${params.length}`);
  }
  return { params, where };
}

class ActionRepository {
  constructor(db, withTransaction) {
    this.db = db;
    this.withTransaction =
      withTransaction ||
      (async (work) => {
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          const result = await work(client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      });
  }

  async list({ status, barcode, marketplace, page = 1, limit = 50 }) {
    const { params, where } = actionFilter({ status, barcode, marketplace });
    params.push(
      Math.min(Number(limit) || 50, 200),
      (Math.max(Number(page) || 1, 1) - 1) * Math.min(Number(limit) || 50, 200),
    );
    return (
      await this.db.query(
        `SELECT ra.*,
          CASE WHEN ra.status IN('PENDING','APPROVED') AND ra.expires_at<NOW()
            THEN 'EXPIRED' ELSE ra.status END display_status,
          outcome.result outcome_result,outcome.elapsed_minutes outcome_elapsed_minutes
         FROM repricer_actions ra
         LEFT JOIN LATERAL(
           SELECT result,elapsed_minutes FROM price_change_outcomes pco
           WHERE pco.action_id=ra.id ORDER BY checked_at DESC LIMIT 1
         ) outcome ON TRUE
         WHERE ${where.join(" AND ")} ORDER BY ra.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
    ).rows;
  }

  async count(filters = {}) {
    const { params, where } = actionFilter(filters);
    return Number(
      (
        await this.db.query(
          `SELECT COUNT(*) FROM repricer_actions ra WHERE ${where.join(" AND ")}`,
          params,
        )
      ).rows[0].count,
    );
  }

  async get(id, client = this.db) {
    return (
      await client.query("SELECT * FROM repricer_actions WHERE id=$1", [id])
    ).rows[0];
  }

  async findOpen(
    barcode,
    client = this.db,
    excludeId = null,
    marketplace = null,
  ) {
    return (
      await client.query(
        `SELECT * FROM repricer_actions WHERE barcode=$1
       AND ($2::text IS NULL OR marketplace=$2)
       AND ($3::bigint IS NULL OR id<>$3)
       AND status IN('PENDING','APPROVED','SENDING','AWAITING_RESULT')
       AND NOT(status IN('PENDING','APPROVED') AND expires_at IS NOT NULL AND expires_at<NOW())
       ORDER BY created_at DESC LIMIT 1`,
        [barcode, marketplace, excludeId],
      )
    ).rows[0];
  }

  async openAutomationActions(marketplace = "TRENDYOL", limit = 200) {
    return (
      await this.db.query(
        `SELECT * FROM repricer_actions
         WHERE marketplace=$1
           AND source IN('AUTO','JOB')
           AND status IN('PENDING','APPROVED')
           AND NOT(expires_at IS NOT NULL AND expires_at<NOW())
         ORDER BY created_at ASC
         LIMIT $2`,
        [
          String(marketplace || "TRENDYOL").toUpperCase(),
          Math.min(Number(limit) || 200, 500),
        ],
      )
    ).rows;
  }

  async findReversal(actionId, client = this.db) {
    return (
      await client.query(
        `SELECT * FROM repricer_actions
         WHERE reverts_action_id=$1 AND status NOT IN('REJECTED','FAILED')
         ORDER BY created_at DESC LIMIT 1`,
        [actionId],
      )
    ).rows[0];
  }

  async create(input, client = this.db) {
    return (
      await client.query(
        `INSERT INTO repricer_actions(
        marketplace,barcode,product_name,old_price,proposed_price,action,strategy,reason,status,source,
        idempotency_key,min_price,buybox_before,rank_before,second_price,third_price,expected_profit,
        expected_margin,safety_checks,expires_at,net_profit_before,target_rank,reverts_action_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23)
       ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=repricer_actions.updated_at RETURNING *`,
        [
          input.marketplace || "TRENDYOL",
          input.barcode,
          input.product_name,
          input.old_price,
          input.proposed_price,
          input.action,
          input.strategy,
          input.reason,
          input.status || "PENDING",
          input.source || "WEB",
          input.idempotency_key,
          input.min_price,
          input.buybox_before,
          input.rank_before,
          input.second_price,
          input.third_price,
          input.expected_profit,
          input.expected_margin,
          JSON.stringify(input.safety_checks || {}),
          input.expires_at,
          input.net_profit_before,
          input.target_rank,
          input.reverts_action_id || null,
        ],
      )
    ).rows[0];
  }

  async recordDecision(actionId, input, decision, client = this.db) {
    await client.query(
      `INSERT INTO repricer_decisions(action_id,barcode,strategy,inputs,decision,rule_version)
      VALUES($1,$2,$3,$4::jsonb,$5::jsonb,'2.0.0')`,
      [
        actionId,
        input.barcode,
        input.strategy,
        JSON.stringify(input),
        JSON.stringify(decision),
      ],
    );
  }

  async pendingOutcomes(elapsedMinutes, actionId = null) {
    return (
      await this.db.query(
        `SELECT ra.*,p.buybox_price buybox_after,p.rank rank_after,p.calculated_net_profit profit_after
      FROM repricer_actions ra JOIN products p ON p.marketplace=ra.marketplace AND p.barcode=ra.barcode
      WHERE ra.status IN('SENT','AWAITING_RESULT','SUCCESS')
      AND ($2::bigint IS NULL OR ra.id=$2)
      AND ra.verified_at IS NOT NULL
      AND ra.sent_at<=NOW()-($1||' minutes')::interval
      AND NOT EXISTS(SELECT 1 FROM price_change_outcomes pco WHERE pco.action_id=ra.id AND pco.elapsed_minutes=$1)`,
        [elapsedMinutes, actionId],
      )
    ).rows;
  }

  async pendingVerifications(limit = 200, actionId = null) {
    return (
      await this.db.query(
        `SELECT * FROM repricer_actions
         WHERE status='AWAITING_RESULT' AND verified_at IS NULL
           AND ($2::bigint IS NULL OR id=$2)
         ORDER BY sent_at ASC LIMIT $1`,
        [Math.min(Math.max(Number(limit) || 200, 1), 500), actionId],
      )
    ).rows;
  }

  async recordMarketPreflight(id, price) {
    return (
      await this.db.query(
        `UPDATE repricer_actions SET market_price_before=$2,
         market_price_checked_at=NOW(),
         updated_at=NOW() WHERE id=$1 RETURNING *`,
        [id, price],
      )
    ).rows[0];
  }

  async confirmApplied(id, { marketProduct, batchResponse }) {
    return this.withTransaction(async (client) => {
      const locked = (
        await client.query(
          "SELECT * FROM repricer_actions WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!locked) throw new Error("Fiyat aksiyonu bulunamadı");
      if (locked.verified_at) return locked;
      if (locked.status !== "AWAITING_RESULT")
        throw new Error("Fiyat aksiyonu doğrulanabilir durumda değil");
      const appliedPrice = Number(marketProduct.salePrice);
      const listPrice = Number(marketProduct.listPrice) || appliedPrice;
      const apiResponse = {
        ...(locked.api_response || {}),
        verification: {
          salePrice: appliedPrice,
          listPrice,
          batch: batchResponse,
        },
      };
      const action = (
        await client.query(
          `UPDATE repricer_actions SET status='SUCCESS',applied_price=$2,verified_at=NOW(),
           batch_checked_at=NOW(),verification_error=NULL,
           api_response=$3::jsonb,
           updated_at=NOW() WHERE id=$1 RETURNING *`,
          [id, appliedPrice, JSON.stringify(apiResponse)],
        )
      ).rows[0];
      await client.query(
        `UPDATE products SET my_price=$1,list_price=$2,
         calculated_net_profit=COALESCE($5,calculated_net_profit),
         calculated_net_margin=COALESCE($6,calculated_net_margin),
         last_price_change_at=NOW(),updated_at=NOW()
         WHERE marketplace=$3 AND barcode=$4`,
        [
          appliedPrice,
          listPrice,
          locked.marketplace,
          locked.barcode,
          locked.expected_profit,
          locked.expected_margin,
        ],
      );
      await client.query(
        `INSERT INTO price_war_log(
          marketplace,barcode,product_name,old_price,new_price,price_diff,
          buybox_price,second_price,third_price,rank,min_price,action
        )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          locked.marketplace,
          locked.barcode,
          locked.product_name,
          locked.old_price,
          appliedPrice,
          appliedPrice - Number(locked.old_price),
          locked.buybox_before,
          locked.second_price,
          locked.third_price,
          locked.rank_before,
          locked.min_price,
          locked.action,
        ],
      );
      if (locked.reverts_action_id) {
        const original = await this.markReverted(
          locked.reverts_action_id,
          locked.id,
          client,
        );
        if (!original)
          throw new Error("Geri alınan aksiyon doğrulama sırasında değişti");
      }
      return action;
    });
  }

  async markVerificationFailed(id, error, batchResponse) {
    const current = await this.get(id);
    const apiResponse = {
      ...(current?.api_response || {}),
      verification: { batch: batchResponse },
    };
    return (
      await this.db.query(
        `UPDATE repricer_actions SET status='FAILED',batch_checked_at=NOW(),
         verification_error=$2,error=$2,
         api_response=$3::jsonb,
         updated_at=NOW() WHERE id=$1 AND status='AWAITING_RESULT'
         RETURNING *`,
        [id, error, JSON.stringify(apiResponse)],
      )
    ).rows[0];
  }

  async recordOutcome(action, outcome) {
    return this.withTransaction(async (client) => {
      const values = [
        action.id,
        action.rank_before,
        action.rank_after,
        action.buybox_before,
        action.buybox_after,
        outcome.buyboxWon,
        outcome.buyboxLost,
        action.net_profit_before,
        action.expected_profit,
        outcome.elapsedMinutes,
        outcome.result,
        action.target_rank,
        outcome.targetAchieved,
        action.profit_after,
      ];
      const recorded = (
        await client.query(
          `INSERT INTO repricer_outcomes(
            action_id,rank_before,rank_after,buybox_before,buybox_after,
            buybox_won,buybox_lost,profit_before,expected_profit,
            elapsed_minutes,outcome,target_rank,target_achieved,profit_after
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT(action_id,elapsed_minutes)DO NOTHING RETURNING *`,
          values,
        )
      ).rows[0];
      if (!recorded) return null;
      await client.query(
        `INSERT INTO price_change_outcomes(
          action_id,marketplace,barcode,old_price,proposed_price,applied_price,
          buybox_before,buybox_after,rank_before,rank_after,target_rank,
          target_achieved,buybox_won,buybox_lost,net_profit_before,
          net_profit_after,expected_net_profit_after,elapsed_minutes,result
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT(action_id,elapsed_minutes)DO NOTHING`,
        [
          action.id,
          action.marketplace,
          action.barcode,
          action.old_price,
          action.proposed_price,
          action.applied_price,
          action.buybox_before,
          action.buybox_after,
          action.rank_before,
          action.rank_after,
          action.target_rank,
          outcome.targetAchieved,
          outcome.buyboxWon,
          outcome.buyboxLost,
          action.net_profit_before,
          action.profit_after,
          action.expected_profit,
          outcome.elapsedMinutes,
          outcome.result,
        ],
      );
      await client.query(
        `INSERT INTO repricer_results(
          action_id,marketplace,barcode,applied_price,buybox_before,buybox_after,
          rank_before,rank_after,target_rank,target_achieved,buybox_won,
          buybox_lost,result,elapsed_minutes,checked_at,updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
        ON CONFLICT(action_id)DO UPDATE SET
          buybox_after=EXCLUDED.buybox_after,rank_after=EXCLUDED.rank_after,
          target_rank=EXCLUDED.target_rank,target_achieved=EXCLUDED.target_achieved,
          buybox_won=EXCLUDED.buybox_won,buybox_lost=EXCLUDED.buybox_lost,
          result=EXCLUDED.result,elapsed_minutes=EXCLUDED.elapsed_minutes,
          checked_at=NOW(),updated_at=NOW()`,
        [
          action.id,
          action.marketplace,
          action.barcode,
          action.applied_price,
          action.buybox_before,
          action.buybox_after,
          action.rank_before,
          action.rank_after,
          action.target_rank,
          outcome.targetAchieved,
          outcome.buyboxWon,
          outcome.buyboxLost,
          outcome.result,
          outcome.elapsedMinutes,
        ],
      );
      await client.query(
        `UPDATE repricer_actions SET rank_after=$2,buybox_after=$3,
         checked_at=NOW(),buybox_won=$4,buybox_lost=$5,elapsed_minutes=$6,
         updated_at=NOW() WHERE id=$1`,
        [
          action.id,
          action.rank_after,
          action.buybox_after,
          outcome.buyboxWon,
          outcome.buyboxLost,
          outcome.elapsedMinutes,
        ],
      );
      return recorded;
    });
  }

  async updateStatus(id, status, fields = {}, client = this.db) {
    return (
      await client.query(
        `UPDATE repricer_actions SET status=$2, approved_by=COALESCE($3,approved_by),
       approved_at=CASE WHEN $2='APPROVED' THEN NOW() ELSE approved_at END,
       sent_at=CASE WHEN $2 IN('SENT','AWAITING_RESULT') THEN NOW() ELSE sent_at END,
       applied_price=COALESCE($4,applied_price), batch_id=COALESCE($5,batch_id),
       api_response=COALESCE($6::jsonb,api_response), error=COALESCE($7,error),updated_at=NOW()
       WHERE id=$1 RETURNING *`,
        [
          id,
          status,
          fields.actor || null,
          fields.appliedPrice || null,
          fields.batchId || null,
          fields.apiResponse ? JSON.stringify(fields.apiResponse) : null,
          fields.error || null,
        ],
      )
    ).rows[0];
  }

  async markReverted(actionId, reversalActionId, client = this.db) {
    return (
      await client.query(
        `UPDATE repricer_actions SET status='REVERTED',
         reverted_by_action_id=$2,reverted_at=NOW(),updated_at=NOW()
         WHERE id=$1 AND status='SUCCESS'
         RETURNING *`,
        [actionId, reversalActionId],
      )
    ).rows[0];
  }

  async todayStats(barcode, marketplace = "TRENDYOL", client = this.db) {
    if (marketplace && typeof marketplace.query === "function") {
      client = marketplace;
      marketplace = "TRENDYOL";
    }
    return (
      await client.query(
        `SELECT COUNT(*)::int action_count,
          COALESCE(SUM(ABS(COALESCE(applied_price,proposed_price)-old_price)),0) total_change,
          (SELECT old_price FROM repricer_actions first_action
           WHERE first_action.marketplace=$2 AND first_action.barcode=$1
             AND first_action.created_at>=CURRENT_DATE
             AND first_action.status IN('SENT','SUCCESS','AWAITING_RESULT')
           ORDER BY first_action.created_at LIMIT 1) day_start_price
       FROM repricer_actions WHERE marketplace=$2 AND barcode=$1
         AND created_at>=CURRENT_DATE
         AND status IN('SENT','SUCCESS','AWAITING_RESULT')`,
        [barcode, marketplace],
      )
    ).rows[0];
  }

  async learningList(barcode, marketplace = "TRENDYOL") {
    const params = [String(marketplace).toUpperCase()];
    let where = "WHERE rl.marketplace=$1";
    if (barcode) {
      params.push(barcode);
      where += " AND rl.barcode=$2";
    }
    return (
      await this.db.query(
        `SELECT rl.*,p.product_name,p.my_price,p.rank,p.buybox_price,
       (SELECT COUNT(*) FROM price_change_outcomes pco
         WHERE pco.marketplace=rl.marketplace AND pco.barcode=rl.barcode)::int outcome_count
       FROM repricer_learning rl LEFT JOIN products p ON p.marketplace=rl.marketplace AND p.barcode=rl.barcode
       ${where} ORDER BY rl.updated_at DESC`,
        params,
      )
    ).rows;
  }

  async learningDetail(barcode, marketplace = "TRENDYOL") {
    const learning = (await this.learningList(barcode, marketplace))[0] || null;
    const attempts = (
      await this.db.query(
        `SELECT ra.id,ra.action,ra.strategy,ra.reason,ra.old_price,
                ra.proposed_price,ra.applied_price,ra.buybox_before,
                ra.rank_before,ra.target_rank,ra.status,ra.created_at,
                GREATEST(COALESCE(ra.buybox_before,0)-
                  COALESCE(ra.applied_price,ra.proposed_price),0) attempted_undercut,
                outcome.result,outcome.elapsed_minutes,outcome.rank_after,
                outcome.buybox_after,outcome.target_achieved,outcome.checked_at
         FROM repricer_actions ra
         LEFT JOIN LATERAL(
           SELECT result,elapsed_minutes,rank_after,buybox_after,
                  target_achieved,checked_at
           FROM price_change_outcomes pco WHERE pco.action_id=ra.id
           ORDER BY checked_at DESC LIMIT 1
         ) outcome ON TRUE
         WHERE ra.marketplace=$1 AND ra.barcode=$2
         ORDER BY ra.created_at DESC LIMIT 20`,
        [marketplace, barcode],
      )
    ).rows;
    return {
      learning,
      attempts,
      nextRecommendation: nextLearningRecommendation(learning),
    };
  }

  async updateLearning(barcode, input, marketplace = "TRENDYOL") {
    return (
      await this.db.query(
        `UPDATE repricer_learning SET learned_price_cut_tl=COALESCE($3,learned_price_cut_tl),
       min_undercut=COALESCE($4,min_undercut),max_undercut=COALESCE($5,max_undercut),
       paused=COALESCE($6,paused),learned_max_increase_tl=COALESCE($7,learned_max_increase_tl),
       strategy=COALESCE($8,strategy),consecutive_failures=COALESCE($9,consecutive_failures),
       updated_at=NOW() WHERE marketplace=$1 AND barcode=$2 RETURNING *`,
        [
          marketplace,
          barcode,
          input.learned_price_cut_tl,
          input.min_undercut,
          input.max_undercut,
          input.paused,
          input.learned_max_increase_tl,
          input.strategy,
          input.consecutive_failures,
        ],
      )
    ).rows[0];
  }

  async applyLearningOutcome(action, outcome) {
    const success = outcome.targetAchieved;
    const current =
      (
        await this.db.query(
          `SELECT * FROM repricer_learning WHERE marketplace=$1 AND barcode=$2`,
          [action.marketplace, action.barcode],
        )
      ).rows[0] || {};
    const oldCut = Number(current.learned_price_cut_tl || 0);
    const attempted = Math.max(
      Number(action.buybox_before || 0) -
        Number(action.applied_price || action.proposed_price || 0),
      0,
    );
    let learned = oldCut,
      failed = Number(current.failed_attempts || 0),
      succeeded = Number(current.success_attempts || 0),
      consecutive = Number(current.consecutive_failures || 0),
      paused = Boolean(current.paused),
      learnedMaxIncrease = Number(current.learned_max_increase_tl || 0),
      learnedStrategy = current.strategy || action.strategy || "Öğrenen Pilot";
    const direction =
      Number(action.proposed_price) > Number(action.old_price)
        ? "increase"
        : Number(action.proposed_price) < Number(action.old_price)
          ? "decrease"
          : "keep";
    if (success) {
      succeeded++;
      consecutive = 0;
      if (attempted > 0)
        learned = oldCut > 0 ? Math.min(oldCut, attempted) : attempted;
    } else if (direction === "decrease") {
      failed++;
      consecutive++;
      if (consecutive <= 3)
        learned = Math.min(
          Number(current.max_undercut || 75),
          Math.max(oldCut, attempted) +
            Math.max(5, Number(action.old_price) * 0.005),
        );
      if (consecutive >= 5) paused = true;
    }
    if (!success && direction !== "decrease") failed++;
    if (direction === "increase") {
      const attemptedIncrease = Math.max(
        Number(action.applied_price || action.proposed_price) -
          Number(action.old_price),
        0,
      );
      if (success) {
        if (attemptedIncrease > 0)
          learnedMaxIncrease = Math.max(learnedMaxIncrease, attemptedIncrease);
      } else if (attemptedIncrease > 0) {
        learnedMaxIncrease = Math.max(0.1, attemptedIncrease * 0.75);
      }
    }
    if (paused) learnedStrategy = "Kâr Koru";
    const confidence =
      Math.min(1, (succeeded + failed) / 5) *
      (succeeded / Math.max(succeeded + failed, 1));
    const scores = { ...(current.strategy_scores || {}) };
    const scoreKey = action.strategy || "Normal";
    const score = scores[scoreKey] || { attempts: 0, successes: 0, score: 0 };
    score.attempts++;
    if (success) score.successes++;
    score.score = Number((score.successes / score.attempts).toFixed(4));
    scores[scoreKey] = score;
    return (
      await this.db.query(
        `INSERT INTO repricer_learning(
      marketplace,barcode,learned_price_cut_tl,failed_attempts,success_attempts,
      consecutive_failures,confidence_score,last_successful_undercut,
      last_failed_undercut,paused,learned_max_increase_tl,strategy,
      strategy_scores,last_outcome,last_rank,last_my_price,last_buybox_price,
      last_second_price,last_required_gap_tl,last_action,last_note,updated_at
    )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,NOW())ON CONFLICT(marketplace,barcode)DO UPDATE SET
      learned_price_cut_tl=EXCLUDED.learned_price_cut_tl,failed_attempts=EXCLUDED.failed_attempts,success_attempts=EXCLUDED.success_attempts,
      consecutive_failures=EXCLUDED.consecutive_failures,confidence_score=EXCLUDED.confidence_score,
      last_successful_undercut=COALESCE(EXCLUDED.last_successful_undercut,repricer_learning.last_successful_undercut),
      last_failed_undercut=COALESCE(EXCLUDED.last_failed_undercut,repricer_learning.last_failed_undercut),
      paused=EXCLUDED.paused,learned_max_increase_tl=COALESCE(EXCLUDED.learned_max_increase_tl,repricer_learning.learned_max_increase_tl),
      strategy=EXCLUDED.strategy,strategy_scores=EXCLUDED.strategy_scores,
      last_outcome=EXCLUDED.last_outcome,last_rank=EXCLUDED.last_rank,
      last_my_price=EXCLUDED.last_my_price,last_buybox_price=EXCLUDED.last_buybox_price,
      last_second_price=EXCLUDED.last_second_price,last_required_gap_tl=EXCLUDED.last_required_gap_tl,
      last_action=EXCLUDED.last_action,last_note=EXCLUDED.last_note,updated_at=NOW()RETURNING *`,
        [
          action.marketplace,
          action.barcode,
          Number(learned.toFixed(2)),
          failed,
          succeeded,
          consecutive,
          Number(confidence.toFixed(4)),
          success ? attempted : null,
          success ? null : attempted,
          paused,
          learnedMaxIncrease > 0 ? Number(learnedMaxIncrease.toFixed(2)) : null,
          learnedStrategy,
          JSON.stringify(scores),
          outcome.result,
          action.rank_after,
          action.applied_price || action.proposed_price,
          action.buybox_after,
          action.second_price,
          attempted,
          action.action,
          success ? "Hedef sıra korundu/alındı" : "Hedef sıra alınamadı",
        ],
      )
    ).rows[0];
  }
}

module.exports = { ActionRepository, nextLearningRecommendation };
