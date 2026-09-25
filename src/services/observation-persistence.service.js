const { env } = require("../config/env");

const TABLE_NAMES = [
  "competitor_price_observations",
  "buybox_history",
  "repricer_observations",
];

function emptyCounters() {
  return Object.fromEntries(
    TABLE_NAMES.map((table) => [
      table,
      { written_change: 0, written_heartbeat: 0, skipped_unchanged: 0 },
    ]),
  );
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function stableJson(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(stableJson);
  if (typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJson(value[key])]),
  );
}

function sameValue(left, right, type) {
  if (type === "number") return numberOrNull(left) === numberOrNull(right);
  if (type === "boolean")
    return (
      (left == null ? null : Boolean(left)) ===
      (right == null ? null : Boolean(right))
    );
  if (type === "json")
    return (
      JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right))
    );
  return textOrNull(left) === textOrNull(right);
}

const COMPARISONS = {
  competitor_price_observations: [
    ["price", "number"],
    ["seller_score", "number"],
    ["coupon_data", "json"],
  ],
  buybox_history: [
    ["product_name", "text"],
    ["observed_price", "number"],
    ["buybox_price", "number"],
    ["second_price", "number"],
    ["third_price", "number"],
    ["rank", "number"],
    ["has_multiple_seller", "boolean"],
    ["min_price", "number"],
    ["net_profit", "number"],
    ["buybox_seller", "text"],
    ["second_seller", "text"],
    ["third_seller", "text"],
    ["seller_count", "number"],
    ["buybox_source", "text"],
  ],
  repricer_observations: [
    ["observed_price", "number"],
    ["buybox_price", "number"],
    ["second_price", "number"],
    ["third_price", "number"],
    ["rank", "number"],
    ["has_multiple_seller", "boolean"],
  ],
};

function meaningfulStateEqual(table, current, previous) {
  if (!previous) return false;
  return COMPARISONS[table].every(([field, type]) =>
    sameValue(current[field], previous[field], type),
  );
}

function observationReason(table, current, previous, heartbeatMs) {
  if (!meaningfulStateEqual(table, current, previous)) return "change";
  const currentTime = new Date(current.observed_at).getTime();
  const previousTime = new Date(previous.observed_at).getTime();
  if (
    Number.isFinite(currentTime) &&
    Number.isFinite(previousTime) &&
    currentTime - previousTime >= heartbeatMs
  )
    return "heartbeat";
  return "skip";
}

function rowsByKey(rows, key) {
  return new Map(rows.map((row) => [key(row), row]));
}

function uniqueSnapshots(snapshots) {
  const byBarcode = new Map();
  for (const snapshot of snapshots || []) {
    const barcode = String(snapshot?.barcode || "").trim();
    if (!barcode) continue;
    byBarcode.set(barcode, { ...snapshot, barcode });
  }
  return [...byBarcode.values()];
}

class ObservationPersistenceService {
  constructor({
    db,
    enabled = env.observationDedupEnabled,
    heartbeatMinutes = env.observationHeartbeatMinutes,
  }) {
    this.db = db;
    this.enabled = enabled;
    this.heartbeatMinutes = Math.max(Number(heartbeatMinutes) || 60, 1);
    this.heartbeatMs = this.heartbeatMinutes * 60000;
  }

  async persist(marketplace, input) {
    const snapshots = uniqueSnapshots(input);
    const counters = emptyCounters();
    if (!snapshots.length) return counters;

    const connected = typeof this.db.connect === "function";
    const client = connected ? await this.db.connect() : this.db;
    try {
      if (connected) await client.query("BEGIN");
      if (this.enabled && connected)
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `aslamaci:observation-persistence:${marketplace}`,
        ]);

      const latest = this.enabled
        ? await this.fetchLatest(client, marketplace, snapshots)
        : {
            competitor_price_observations: new Map(),
            buybox_history: new Map(),
            repricer_observations: new Map(),
          };
      const selected = {
        competitor_price_observations: [],
        buybox_history: [],
        repricer_observations: [],
      };

      for (const snapshot of snapshots) {
        const rows = {
          buybox_history: {
            barcode: snapshot.barcode,
            observed_at: snapshot.observed_at,
            ...snapshot.buybox,
          },
          repricer_observations: {
            barcode: snapshot.barcode,
            observed_at: snapshot.observed_at,
            ...snapshot.repricer,
          },
        };
        for (const table of ["buybox_history", "repricer_observations"]) {
          const row = rows[table];
          const reason = this.enabled
            ? observationReason(
                table,
                row,
                latest[table].get(snapshot.barcode),
                this.heartbeatMs,
              )
            : "change";
          if (reason === "skip") counters[table].skipped_unchanged++;
          else {
            counters[table][`written_${reason}`]++;
            selected[table].push(row);
          }
        }

        for (const competitor of snapshot.competitors || []) {
          const row = {
            barcode: snapshot.barcode,
            observed_at: snapshot.observed_at,
            seller_score: null,
            coupon_data: null,
            ...competitor,
          };
          const key = `${snapshot.barcode}:${row.rank}`;
          const reason = this.enabled
            ? observationReason(
                "competitor_price_observations",
                row,
                latest.competitor_price_observations.get(key),
                this.heartbeatMs,
              )
            : "change";
          if (reason === "skip")
            counters.competitor_price_observations.skipped_unchanged++;
          else {
            counters.competitor_price_observations[`written_${reason}`]++;
            selected.competitor_price_observations.push(row);
          }
        }
      }

      await this.insertSelected(client, marketplace, selected);
      if (connected) await client.query("COMMIT");
      return counters;
    } catch (error) {
      if (connected) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (connected) client.release();
    }
  }

  async fetchLatest(client, marketplace, snapshots) {
    const barcodes = snapshots.map((snapshot) => snapshot.barcode);
    const competitorKeys = snapshots.flatMap((snapshot) =>
      (snapshot.competitors || []).map((row) => ({
        barcode: snapshot.barcode,
        rank: row.rank,
      })),
    );
    const [buybox, repricer, competitor] = await Promise.all([
      client.query(
        `WITH keys AS (SELECT DISTINCT UNNEST($2::text[]) AS barcode)
         SELECT latest.* FROM keys
         JOIN LATERAL (
           SELECT h.* FROM buybox_history h
           WHERE h.marketplace=$1 AND h.barcode=keys.barcode
           ORDER BY h.observed_at DESC,h.id DESC LIMIT 1
         ) latest ON TRUE`,
        [marketplace, barcodes],
      ),
      client.query(
        `WITH keys AS (SELECT DISTINCT UNNEST($2::text[]) AS barcode)
         SELECT latest.* FROM keys
         JOIN LATERAL (
           SELECT r.* FROM repricer_observations r
           WHERE r.marketplace=$1 AND r.barcode=keys.barcode
           ORDER BY r.observed_at DESC,r.id DESC LIMIT 1
         ) latest ON TRUE`,
        [marketplace, barcodes],
      ),
      competitorKeys.length
        ? client.query(
            `WITH keys AS (
               SELECT DISTINCT barcode,rank
               FROM jsonb_to_recordset($2::jsonb) AS key(barcode text,rank integer)
             )
             SELECT latest.* FROM keys
             JOIN LATERAL (
               SELECT c.* FROM competitor_price_observations c
               WHERE c.marketplace=$1 AND c.barcode=keys.barcode AND c.rank=keys.rank
               ORDER BY c.observed_at DESC,c.id DESC LIMIT 1
             ) latest ON TRUE`,
            [marketplace, JSON.stringify(competitorKeys)],
          )
        : Promise.resolve({ rows: [] }),
    ]);
    return {
      buybox_history: rowsByKey(buybox.rows, (row) => String(row.barcode)),
      repricer_observations: rowsByKey(repricer.rows, (row) =>
        String(row.barcode),
      ),
      competitor_price_observations: rowsByKey(
        competitor.rows,
        (row) => `${row.barcode}:${row.rank}`,
      ),
    };
  }

  async insertSelected(client, marketplace, selected) {
    if (selected.repricer_observations.length)
      await client.query(
        `INSERT INTO repricer_observations(
           marketplace,barcode,observed_price,buybox_price,second_price,
           third_price,rank,has_multiple_seller,observed_at
         )
         SELECT $1,row.barcode,row.observed_price,row.buybox_price,row.second_price,
                row.third_price,row.rank,row.has_multiple_seller,row.observed_at
         FROM jsonb_to_recordset($2::jsonb) AS row(
           barcode text,observed_price numeric,buybox_price numeric,
           second_price numeric,third_price numeric,rank integer,
           has_multiple_seller boolean,observed_at timestamptz
         )
         ON CONFLICT(marketplace,barcode,observed_at) DO NOTHING`,
        [marketplace, JSON.stringify(selected.repricer_observations)],
      );
    if (selected.buybox_history.length)
      await client.query(
        `INSERT INTO buybox_history(
           marketplace,barcode,product_name,observed_price,buybox_price,
           second_price,third_price,rank,has_multiple_seller,min_price,
           net_profit,observed_at,buybox_seller,second_seller,third_seller,
           seller_count,buybox_source
         )
         SELECT $1,row.barcode,row.product_name,row.observed_price,row.buybox_price,
                row.second_price,row.third_price,row.rank,row.has_multiple_seller,
                row.min_price,row.net_profit,row.observed_at,row.buybox_seller,
                row.second_seller,row.third_seller,row.seller_count,row.buybox_source
         FROM jsonb_to_recordset($2::jsonb) AS row(
           barcode text,product_name text,observed_price numeric,buybox_price numeric,
           second_price numeric,third_price numeric,rank integer,
           has_multiple_seller boolean,min_price numeric,net_profit numeric,
           observed_at timestamptz,buybox_seller text,second_seller text,
           third_seller text,seller_count integer,buybox_source text
         )
         ON CONFLICT(marketplace,barcode,observed_at) DO NOTHING`,
        [marketplace, JSON.stringify(selected.buybox_history)],
      );
    if (selected.competitor_price_observations.length)
      await client.query(
        `INSERT INTO competitor_price_observations(
           marketplace,barcode,rank,price,seller_score,coupon_data,observed_at
         )
         SELECT $1,row.barcode,row.rank,row.price,row.seller_score,row.coupon_data,row.observed_at
         FROM jsonb_to_recordset($2::jsonb) AS row(
           barcode text,rank integer,price numeric,seller_score numeric,
           coupon_data jsonb,observed_at timestamptz
         )`,
        [marketplace, JSON.stringify(selected.competitor_price_observations)],
      );
  }
}

module.exports = {
  ObservationPersistenceService,
  TABLE_NAMES,
  emptyCounters,
  meaningfulStateEqual,
  observationReason,
};
