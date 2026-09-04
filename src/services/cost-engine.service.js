const { env } = require("../config/env");

class CostEngineService {
  constructor(db) {
    this.db = db;
  }

  async recalculate(barcode, queryable = this.db, marketplace = "TRENDYOL") {
    queryable = queryable || this.db;
    const normalizedMarketplace = String(
      marketplace || "TRENDYOL",
    ).toUpperCase();
    const stored = (
      await queryable.query(
        `SELECT key,value FROM system_settings
         WHERE key IN(
           'default_carrier','service_fee',
           'default_carrier_trendyol','default_carrier_hepsiburada',
           'service_fee_trendyol','service_fee_hepsiburada'
         )`,
      )
    ).rows;
    const settings = Object.fromEntries(
      stored.map((row) => [row.key, row.value]),
    );
    const params = [
      settings[`default_carrier_${normalizedMarketplace.toLowerCase()}`] ||
        settings.default_carrier ||
        env.defaultCarrier,
      Number(
        settings[`service_fee_${normalizedMarketplace.toLowerCase()}`] ??
          settings.service_fee ??
          env.defaultServiceFee,
      ),
      normalizedMarketplace,
    ];
    let filter = "";
    if (barcode) {
      params.push(barcode);
      filter = `AND p.barcode=$${params.length}`;
    }
    const result = await queryable.query(
      `
      WITH mapping_totals AS (
        SELECT pcm.marketplace,pcm.barcode,
          SUM(pcm.quantity*COALESCE(pcm.effective_unit_cost,ci.unit_cost)) product_cost,
          SUM(pcm.quantity*COALESCE(ci.unit_desi,0)) total_desi,
          COUNT(*) FILTER(WHERE ci.item_code IS NULL OR pcm.quantity<=0) orphan_count,
          COUNT(*) FILTER(WHERE ci.item_code IS NOT NULL AND (ci.unit_cost<=0 OR COALESCE(ci.unit_desi,0)<=0)) incomplete_cost_count,
          COUNT(*) mapping_count
        FROM product_cost_mappings pcm LEFT JOIN cost_items ci ON ci.item_code=pcm.cost_item_code
        WHERE pcm.marketplace=$3 GROUP BY pcm.marketplace,pcm.barcode
      ), calculated AS (
        SELECT p.marketplace,p.barcode,COALESCE(mt.product_cost,0) product_cost,
          COALESCE(p.manual_desi_override,CEIL(COALESCE(mt.total_desi,0))) total_desi,
          COALESCE(sb.cost_inc_vat,sc.cost_inc_vat,0) shipping_cost,
          COALESCE(pr.packaging_cost,0) packaging_cost,
          pr.id packaging_rule_id,pr.profile_name packaging_profile_name,
          pr.rule_scope packaging_rule_source,
          COALESCE(mt.orphan_count,0) orphan_count,COALESCE(mt.mapping_count,0) mapping_count,
          COALESCE(mt.incomplete_cost_count,0) incomplete_cost_count,
          (pr.id IS NOT NULL) packaging_rule_found
        FROM products p LEFT JOIN mapping_totals mt ON mt.marketplace=p.marketplace AND mt.barcode=p.barcode
        LEFT JOIN LATERAL(
          SELECT * FROM shipping_barems x WHERE x.marketplace=p.marketplace
            AND x.carrier=$1 AND p.my_price BETWEEN x.min_basket AND x.max_basket
          ORDER BY x.min_basket DESC LIMIT 1
        ) sb ON TRUE
        LEFT JOIN LATERAL(
          SELECT * FROM shipping_costs x
          WHERE x.marketplace=p.marketplace AND x.carrier=$1
            AND x.desi_kg=COALESCE(p.manual_desi_override,CEIL(COALESCE(mt.total_desi,0))) LIMIT 1
        ) sc ON sb.id IS NULL
        LEFT JOIN LATERAL(
          SELECT * FROM packaging_rules x WHERE(
              x.marketplace=p.marketplace OR
              (p.marketplace='HEPSIBURADA' AND x.marketplace='TRENDYOL')
            )
            AND COALESCE(x.active,TRUE)=TRUE AND(
              (x.rule_scope='BARCODE' AND UPPER(x.match_value)=UPPER(p.barcode)) OR
              (x.rule_scope='PRODUCT_NAME' AND p.product_name ILIKE '%'||x.match_value||'%') OR
              (x.rule_scope='CATEGORY' AND p.category_name ILIKE '%'||x.match_value||'%') OR
              (x.rule_scope='BRAND' AND p.brand ILIKE '%'||x.match_value||'%') OR
              (x.rule_scope='DESI' AND COALESCE(p.manual_desi_override,CEIL(COALESCE(mt.total_desi,0))) BETWEEN x.min_desi AND x.max_desi)
            )
          ORDER BY CASE x.rule_scope WHEN 'BARCODE' THEN 5 WHEN 'PRODUCT_NAME' THEN 4
            WHEN 'CATEGORY' THEN 3 WHEN 'BRAND' THEN 2 ELSE 1 END DESC,
            x.priority DESC,
            CASE WHEN x.marketplace=p.marketplace THEN 1 ELSE 0 END DESC,
            x.id DESC LIMIT 1
        ) pr ON TRUE
        WHERE p.marketplace=$3 ${filter}
      )
      UPDATE products p SET
        calculated_product_cost=c.product_cost,desi=c.total_desi,calculated_shipping_cost=c.shipping_cost,
        packaging_cost=c.packaging_cost,service_fee=COALESCE(p.service_fee,$2),
        packaging_rule_id=c.packaging_rule_id,
        packaging_profile_name=c.packaging_profile_name,
        packaging_rule_source=c.packaging_rule_source,
        calculated_total_cost=c.product_cost+c.shipping_cost+c.packaging_cost+COALESCE(p.service_fee,$2)+COALESCE(p.target_profit,0),
        calculated_min_price=CASE WHEN p.commission_rate>0 AND p.commission_rate<100 THEN
          ROUND((c.product_cost+c.shipping_cost+c.packaging_cost+COALESCE(p.service_fee,$2)+COALESCE(p.target_profit,0))/(1-p.commission_rate/100),2) ELSE 0 END,
        min_price=CASE WHEN p.commission_rate>0 AND p.commission_rate<100 THEN
          ROUND((c.product_cost+c.shipping_cost+c.packaging_cost+COALESCE(p.service_fee,$2)+COALESCE(p.target_profit,0))/(1-p.commission_rate/100),2) ELSE 0 END,
        calculated_net_profit=CASE WHEN p.commission_rate>0 THEN ROUND(p.my_price-(p.my_price*p.commission_rate/100)-c.product_cost-c.shipping_cost-c.packaging_cost-COALESCE(p.service_fee,$2),2) ELSE 0 END,
        calculated_net_margin=CASE WHEN p.my_price>0 AND p.commission_rate>0 THEN ROUND(((p.my_price-(p.my_price*p.commission_rate/100)-c.product_cost-c.shipping_cost-c.packaging_cost-COALESCE(p.service_fee,$2))/p.my_price)*100,2) ELSE 0 END,
        needs_cost_mapping=(c.mapping_count=0 OR c.product_cost<=0 OR c.orphan_count>0 OR c.incomplete_cost_count>0),
        data_complete=(c.product_cost>0 AND c.total_desi>0 AND c.shipping_cost>0 AND c.packaging_rule_found AND COALESCE(p.service_fee,$2)>=0 AND p.commission_rate>0 AND c.orphan_count=0 AND c.incomplete_cost_count=0 AND c.mapping_count>0),
        data_status=CASE
          WHEN c.mapping_count=0 THEN 'MAPPING_MISSING' WHEN c.orphan_count>0 THEN 'ORPHAN_MAPPING'
          WHEN c.incomplete_cost_count>0 THEN 'COST_ITEM_INCOMPLETE'
          WHEN p.commission_rate IS NULL OR p.commission_rate<=0 THEN 'COMMISSION_MISSING'
          WHEN c.total_desi<=0 THEN 'DESI_MISSING' WHEN c.shipping_cost<=0 THEN 'SHIPPING_MISSING'
          WHEN NOT c.packaging_rule_found THEN 'PACKAGING_MISSING' ELSE 'COMPLETE' END,
        updated_at=NOW()
      FROM calculated c WHERE p.marketplace=c.marketplace AND p.barcode=c.barcode RETURNING p.barcode,p.data_complete,p.min_price
    `,
      params,
    );
    return { processed: result.rowCount, items: result.rows };
  }
}

module.exports = { CostEngineService };
