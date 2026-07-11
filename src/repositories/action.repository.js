class ActionRepository {
  constructor(db) { this.db = db; }

  async list({ status, barcode, page = 1, limit = 50 }) {
    const params=[]; const where=["1=1"];
    if(status){params.push(status);where.push(`status=$${params.length}`);}
    if(barcode){params.push(barcode);where.push(`barcode=$${params.length}`);}
    params.push(Math.min(Number(limit)||50,200),(Math.max(Number(page)||1,1)-1)*Math.min(Number(limit)||50,200));
    return (await this.db.query(
      `SELECT * FROM repricer_actions WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params
    )).rows;
  }

  async get(id, client = this.db) {
    return (await client.query("SELECT * FROM repricer_actions WHERE id=$1",[id])).rows[0];
  }

  async findOpen(barcode, client = this.db) {
    return (await client.query(
      `SELECT * FROM repricer_actions WHERE barcode=$1 AND status IN('PENDING','APPROVED','SENDING','AWAITING_RESULT')
       ORDER BY created_at DESC LIMIT 1`,[barcode]
    )).rows[0];
  }

  async create(input, client = this.db) {
    return (await client.query(
      `INSERT INTO repricer_actions(
        marketplace,barcode,product_name,old_price,proposed_price,action,strategy,reason,status,source,
        idempotency_key,min_price,buybox_before,rank_before,second_price,third_price,expected_profit,
        expected_margin,safety_checks,expires_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20)
       ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=repricer_actions.updated_at RETURNING *`,
      [input.marketplace||"TRENDYOL",input.barcode,input.product_name,input.old_price,input.proposed_price,
       input.action,input.strategy,input.reason,input.status||"PENDING",input.source||"WEB",input.idempotency_key,
       input.min_price,input.buybox_before,input.rank_before,input.second_price,input.third_price,input.expected_profit,
       input.expected_margin,JSON.stringify(input.safety_checks||{}),input.expires_at]
    )).rows[0];
  }

  async recordDecision(actionId,input,decision,client=this.db){
    await client.query(`INSERT INTO repricer_decisions(action_id,barcode,strategy,inputs,decision,rule_version)
      VALUES($1,$2,$3,$4::jsonb,$5::jsonb,'2.0.0')`,[actionId,input.barcode,input.strategy,JSON.stringify(input),JSON.stringify(decision)]);
  }

  async pendingOutcomes(elapsedMinutes){
    return (await this.db.query(`SELECT ra.*,p.buybox_price buybox_after,p.rank rank_after,p.calculated_net_profit profit_after
      FROM repricer_actions ra JOIN products p ON p.marketplace=ra.marketplace AND p.barcode=ra.barcode
      WHERE ra.status IN('SENT','AWAITING_RESULT','SUCCESS') AND ra.sent_at<=NOW()-($1||' minutes')::interval
      AND NOT EXISTS(SELECT 1 FROM repricer_outcomes ro WHERE ro.action_id=ra.id AND ro.elapsed_minutes=$1)`,[elapsedMinutes])).rows;
  }

  async recordOutcome(action,outcome){
    return (await this.db.query(`INSERT INTO repricer_outcomes(action_id,rank_before,rank_after,buybox_before,buybox_after,buybox_won,buybox_lost,profit_before,expected_profit,elapsed_minutes,outcome)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(action_id,elapsed_minutes)DO NOTHING RETURNING *`,
      [action.id,action.rank_before,action.rank_after,action.buybox_before,action.buybox_after,outcome.buyboxWon,outcome.buyboxLost,action.net_profit_before,action.expected_profit,outcome.elapsedMinutes,outcome.result]
    )).rows[0];
  }

  async updateStatus(id, status, fields = {}, client = this.db) {
    return (await client.query(
      `UPDATE repricer_actions SET status=$2, approved_by=COALESCE($3,approved_by),
       approved_at=CASE WHEN $2='APPROVED' THEN NOW() ELSE approved_at END,
       sent_at=CASE WHEN $2 IN('SENT','AWAITING_RESULT') THEN NOW() ELSE sent_at END,
       applied_price=COALESCE($4,applied_price), batch_id=COALESCE($5,batch_id),
       api_response=COALESCE($6::jsonb,api_response), error=COALESCE($7,error),updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id,status,fields.actor||null,fields.appliedPrice||null,fields.batchId||null,
       fields.apiResponse?JSON.stringify(fields.apiResponse):null,fields.error||null]
    )).rows[0];
  }

  async todayStats(barcode, client = this.db) {
    return (await client.query(
      `SELECT COUNT(*)::int action_count,COALESCE(SUM(ABS(COALESCE(applied_price,proposed_price)-old_price)),0) total_change
       FROM repricer_actions WHERE barcode=$1 AND created_at>=CURRENT_DATE AND status IN('SENT','SUCCESS','AWAITING_RESULT')`,[barcode]
    )).rows[0];
  }

  async learningList(barcode) {
    const params=[]; let where="";
    if(barcode){params.push(barcode);where="WHERE rl.barcode=$1";}
    return (await this.db.query(
      `SELECT rl.*,p.product_name,p.my_price,p.rank,p.buybox_price,
       (SELECT COUNT(*) FROM repricer_outcomes ro JOIN repricer_actions ra ON ra.id=ro.action_id WHERE ra.barcode=rl.barcode)::int outcome_count
       FROM repricer_learning rl LEFT JOIN products p ON p.marketplace=rl.marketplace AND p.barcode=rl.barcode
       ${where} ORDER BY rl.updated_at DESC`,params
    )).rows;
  }

  async updateLearning(barcode, input) {
    return (await this.db.query(
      `UPDATE repricer_learning SET learned_price_cut_tl=COALESCE($2,learned_price_cut_tl),
       min_undercut=COALESCE($3,min_undercut),max_undercut=COALESCE($4,max_undercut),
       paused=COALESCE($5,paused),updated_at=NOW() WHERE marketplace='TRENDYOL' AND barcode=$1 RETURNING *`,
      [barcode,input.learned_price_cut_tl,input.min_undercut,input.max_undercut,input.paused]
    )).rows[0];
  }

  async applyLearningOutcome(action,outcome){
    const success=outcome.buyboxWon;const current=(await this.db.query(
      `SELECT * FROM repricer_learning WHERE marketplace=$1 AND barcode=$2`,[action.marketplace,action.barcode]
    )).rows[0]||{};
    const oldCut=Number(current.learned_price_cut_tl||0);const attempted=Math.max(Number(action.buybox_before||0)-Number(action.applied_price||action.proposed_price||0),0);
    let learned=oldCut,failed=Number(current.failed_attempts||0),succeeded=Number(current.success_attempts||0),consecutive=Number(current.consecutive_failures||0),paused=Boolean(current.paused);
    if(success){succeeded++;consecutive=0;if(attempted>0)learned=oldCut>0?Math.min(oldCut,attempted):attempted;}
    else if(Number(action.proposed_price)<Number(action.old_price)){failed++;consecutive++;if(consecutive<=3)learned=Math.min(Number(current.max_undercut||75),Math.max(oldCut,attempted)+Math.max(5,Number(action.old_price)*0.005));if(consecutive>=5)paused=true;}
    const confidence=Math.min(1,(succeeded+failed)/5)*(succeeded/Math.max(succeeded+failed,1));
    return (await this.db.query(`INSERT INTO repricer_learning(
      marketplace,barcode,learned_price_cut_tl,failed_attempts,success_attempts,consecutive_failures,confidence_score,last_successful_undercut,last_failed_undercut,paused,updated_at
    )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())ON CONFLICT(marketplace,barcode)DO UPDATE SET
      learned_price_cut_tl=EXCLUDED.learned_price_cut_tl,failed_attempts=EXCLUDED.failed_attempts,success_attempts=EXCLUDED.success_attempts,
      consecutive_failures=EXCLUDED.consecutive_failures,confidence_score=EXCLUDED.confidence_score,
      last_successful_undercut=COALESCE(EXCLUDED.last_successful_undercut,repricer_learning.last_successful_undercut),
      last_failed_undercut=COALESCE(EXCLUDED.last_failed_undercut,repricer_learning.last_failed_undercut),paused=EXCLUDED.paused,updated_at=NOW()RETURNING *`,
      [action.marketplace,action.barcode,Number(learned.toFixed(2)),failed,succeeded,consecutive,Number(confidence.toFixed(4)),success?attempted:null,success?null:attempted,paused]
    )).rows[0];
  }
}

module.exports = { ActionRepository };
