const fs = require("fs");
const path = require("path");

const HEPSIBURADA_TARIFF_PATH = path.resolve(
  __dirname,
  "../../data/hepsiburada-shipping-2026-07-13.json",
);

class ShippingTariffService {
  constructor({ db }) {
    this.db = db;
  }

  readHepsiburadaTariff() {
    const data = JSON.parse(fs.readFileSync(HEPSIBURADA_TARIFF_PATH, "utf8"));
    if (
      data.marketplace !== "HEPSIBURADA" ||
      !Array.isArray(data.carriers) ||
      !Array.isArray(data.rows) ||
      data.rows.length !== 4501
    )
      throw new Error("Hepsiburada kargo tarifesi doğrulanamadı");
    return data;
  }

  async importHepsiburada({ force = false } = {}) {
    const tariff = this.readHepsiburadaTariff();
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query(
        `SELECT * FROM shipping_tariff_imports
         WHERE marketplace='HEPSIBURADA' AND source_version=$1 FOR UPDATE`,
        [tariff.effectiveDate],
      );
      const actualRates = await client.query(
        `SELECT COUNT(*)::integer AS count FROM shipping_costs
         WHERE marketplace='HEPSIBURADA'`,
      );
      const actualRateCount = Number(actualRates.rows[0]?.count || 0);
      const recordedRateCount = Number(previous.rows[0]?.rate_count || 0);
      if (
        previous.rowCount &&
        !force &&
        actualRateCount > 0 &&
        actualRateCount === recordedRateCount
      ) {
        await client.query("COMMIT");
        return {
          processed: 0,
          successful: 0,
          failed: 0,
          metadata: {
            skipped: true,
            sourceVersion: tariff.effectiveDate,
            rateCount: actualRateCount,
          },
        };
      }
      await client.query(
        "DELETE FROM shipping_costs WHERE marketplace='HEPSIBURADA'",
      );
      const rates = [];
      for (const row of tariff.rows) {
        const desi = Number(row[0]);
        for (let index = 0; index < tariff.carriers.length; index++) {
          const cost = Number(row[index + 1]);
          if (!Number.isFinite(cost) || cost <= 0) continue;
          rates.push({
            desi,
            carrier: tariff.carriers[index],
            cost,
          });
        }
      }
      for (let offset = 0; offset < rates.length; offset += 500) {
        const batch = rates.slice(offset, offset + 500);
        const params = [];
        const values = batch.map((rate, index) => {
          const base = index * 3;
          params.push(rate.desi, rate.carrier, rate.cost);
          return `('HEPSIBURADA',$${base + 1},$${base + 2},$${base + 3},
            ROUND($${base + 3}*(1+${Number(tariff.vatRate)}/100),2),
            ${Number(tariff.vatRate)},NOW())`;
        });
        await client.query(
          `INSERT INTO shipping_costs(
             marketplace,desi_kg,carrier,cost_ex_vat,cost_inc_vat,vat_rate,
             updated_at
           )VALUES ${values.join(",")}`,
          params,
        );
      }
      await client.query(
        `INSERT INTO shipping_tariff_imports(
           marketplace,source_version,source_name,rate_count,imported_at
         )VALUES('HEPSIBURADA',$1,$2,$3,NOW())
         ON CONFLICT(marketplace,source_version)DO UPDATE SET
           source_name=EXCLUDED.source_name,rate_count=EXCLUDED.rate_count,
           imported_at=NOW()`,
        [tariff.effectiveDate, tariff.source, rates.length],
      );
      await client.query("COMMIT");
      return {
        processed: rates.length,
        successful: rates.length,
        failed: 0,
        metadata: {
          sourceVersion: tariff.effectiveDate,
          desiRows: tariff.rows.length,
          carriers: tariff.carriers.length,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { ShippingTariffService, HEPSIBURADA_TARIFF_PATH };
