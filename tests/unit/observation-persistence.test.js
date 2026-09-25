const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ObservationPersistenceService,
} = require("../../src/services/observation-persistence.service");

function memoryDb() {
  const tables = {
    competitor_price_observations: [],
    buybox_history: [],
    repricer_observations: [],
  };
  const locks = new Map();
  let queryCount = 0;

  function latest(rows, marketplace, key) {
    return rows
      .filter((row) => row.marketplace === marketplace && key(row))
      .sort(
        (left, right) =>
          new Date(right.observed_at).getTime() -
          new Date(left.observed_at).getTime(),
      )[0];
  }

  function client() {
    let unlock = null;
    return {
      async query(sql, params = []) {
        queryCount++;
        const text = String(sql);
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
          if ((text === "COMMIT" || text === "ROLLBACK") && unlock) {
            unlock();
            unlock = null;
          }
          return { rows: [] };
        }
        if (text.includes("pg_advisory_xact_lock")) {
          const key = params[0];
          const previous = locks.get(key) || Promise.resolve();
          let release;
          const current = new Promise((resolve) => {
            release = resolve;
          });
          locks.set(
            key,
            previous.then(() => current),
          );
          await previous;
          unlock = release;
          return { rows: [{}] };
        }
        if (
          text.includes("FROM buybox_history h") &&
          !text.includes("INSERT INTO")
        ) {
          const [marketplace, barcodes] = params;
          return {
            rows: barcodes.flatMap((barcode) => {
              const row = latest(
                tables.buybox_history,
                marketplace,
                (candidate) => candidate.barcode === barcode,
              );
              return row ? [row] : [];
            }),
          };
        }
        if (
          text.includes("FROM repricer_observations r") &&
          !text.includes("INSERT INTO")
        ) {
          const [marketplace, barcodes] = params;
          return {
            rows: barcodes.flatMap((barcode) => {
              const row = latest(
                tables.repricer_observations,
                marketplace,
                (candidate) => candidate.barcode === barcode,
              );
              return row ? [row] : [];
            }),
          };
        }
        if (
          text.includes("FROM competitor_price_observations c") &&
          !text.includes("INSERT INTO")
        ) {
          const [marketplace, json] = params;
          return {
            rows: JSON.parse(json).flatMap((key) => {
              const row = latest(
                tables.competitor_price_observations,
                marketplace,
                (candidate) =>
                  candidate.barcode === key.barcode &&
                  candidate.rank === key.rank,
              );
              return row ? [row] : [];
            }),
          };
        }
        for (const table of Object.keys(tables)) {
          if (!text.includes(`INSERT INTO ${table}`)) continue;
          const [marketplace, json] = params;
          const rows = JSON.parse(json).map((row) => ({
            ...row,
            marketplace,
            id: tables[table].length + 1,
          }));
          tables[table].push(...rows);
          return { rows: [], rowCount: rows.length };
        }
        throw new Error(`Unexpected query: ${text}`);
      },
      release() {},
    };
  }

  return {
    tables,
    get queryCount() {
      return queryCount;
    },
    connect: async () => client(),
  };
}

function snapshot(at, overrides = {}) {
  const buyboxPrice = overrides.buybox_price ?? 50;
  const rank = overrides.rank ?? 2;
  return {
    barcode: overrides.barcode || "ABC",
    observed_at: new Date(at),
    repricer: {
      observed_price: 60,
      buybox_price: buyboxPrice,
      second_price: 55,
      third_price: 58,
      rank,
      has_multiple_seller: true,
    },
    buybox: {
      product_name: "Test ürün",
      observed_price: 60,
      buybox_price: buyboxPrice,
      second_price: 55,
      third_price: 58,
      rank,
      has_multiple_seller: true,
      min_price: 45,
      net_profit: 10,
      buybox_seller: overrides.buybox_seller || "Rakip A",
      second_seller: "Biz",
      third_seller: "Rakip B",
      seller_count: 3,
      buybox_source: "TEST",
    },
    competitors: [{ rank: 1, price: buyboxPrice }],
  };
}

test("meaningful change yazilir, tekrar atlanir ve 60 dakika heartbeat yazilir", async () => {
  const db = memoryDb();
  const service = new ObservationPersistenceService({
    db,
    heartbeatMinutes: 60,
  });

  const first = await service.persist("TRENDYOL", [
    snapshot("2026-09-25T10:00:00Z"),
  ]);
  const repeated = await service.persist("TRENDYOL", [
    snapshot("2026-09-25T10:05:00Z"),
  ]);
  const heartbeat = await service.persist("TRENDYOL", [
    snapshot("2026-09-25T11:00:00Z"),
  ]);
  const changed = await service.persist("TRENDYOL", [
    snapshot("2026-09-25T11:01:00Z", { buybox_price: 49 }),
  ]);

  for (const table of Object.keys(db.tables))
    assert.equal(db.tables[table].length, 3);
  assert.equal(first.buybox_history.written_change, 1);
  assert.equal(repeated.buybox_history.skipped_unchanged, 1);
  assert.equal(heartbeat.buybox_history.written_heartbeat, 1);
  assert.equal(changed.buybox_history.written_change, 1);
});

test("Buybox sahibi ve rank geçişleri hemen saklanır", async () => {
  const db = memoryDb();
  const service = new ObservationPersistenceService({ db });
  await service.persist("TRENDYOL", [snapshot("2026-09-25T10:00:00Z")]);

  const owner = await service.persist("TRENDYOL", [
    snapshot("2026-09-25T10:01:00Z", { buybox_seller: "Rakip C" }),
  ]);
  assert.equal(owner.buybox_history.written_change, 1);
  assert.equal(owner.repricer_observations.skipped_unchanged, 1);

  const rank = await service.persist("TRENDYOL", [
    snapshot("2026-09-25T10:02:00Z", {
      buybox_seller: "Rakip C",
      rank: 1,
    }),
  ]);
  assert.equal(rank.buybox_history.written_change, 1);
  assert.equal(rank.repricer_observations.written_change, 1);
});

test("eşzamanlı aynı snapshot marketplace lock altında tek kez yazılır", async () => {
  const db = memoryDb();
  const service = new ObservationPersistenceService({ db });
  const state = snapshot("2026-09-25T10:00:00Z");

  await Promise.all([
    service.persist("TRENDYOL", [state]),
    service.persist("TRENDYOL", [state]),
  ]);

  assert.equal(db.tables.buybox_history.length, 1);
  assert.equal(db.tables.repricer_observations.length, 1);
  assert.equal(db.tables.competitor_price_observations.length, 1);
});

test("aynı barkod Trendyol ve Hepsiburada arasında suppression paylaşmaz", async () => {
  const db = memoryDb();
  const service = new ObservationPersistenceService({ db });
  const state = snapshot("2026-09-25T10:00:00Z");

  await service.persist("TRENDYOL", [state]);
  await service.persist("HEPSIBURADA", [state]);

  assert.deepEqual(
    db.tables.buybox_history.map((row) => row.marketplace).sort(),
    ["HEPSIBURADA", "TRENDYOL"],
  );
});

test("batch boyutu artsa da latest-state okuma sayısı ürün başına artmaz", async () => {
  const db = memoryDb();
  const service = new ObservationPersistenceService({ db });
  const rows = Array.from({ length: 100 }, (_, index) =>
    snapshot("2026-09-25T10:00:00Z", { barcode: `SKU-${index}` }),
  );

  await service.persist("TRENDYOL", rows);

  assert.equal(db.tables.buybox_history.length, 100);
  assert.equal(db.queryCount, 9);
});
