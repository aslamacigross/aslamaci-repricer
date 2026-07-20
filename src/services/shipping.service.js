const {
  selectShippingCost,
  selectPackagingCost,
} = require("../domain/pricing");
const { decimalToInteger, integerToDecimal } = require("../utils/numbers");

class ShippingService {
  constructor(costs) {
    this.costs = costs;
  }

  async preview({ sale_price, desi, carrier, marketplace = "TRENDYOL" }) {
    const data = await this.costs.shipping(marketplace);
    const salePrice = Number(sale_price);
    const dimensionalWeight = Number(desi);
    const selectedBarem = data.barems.find(
      (item) =>
        item.carrier === carrier &&
        salePrice >= Number(item.min_basket) &&
        salePrice <= Number(item.max_basket),
    );
    const roundedDesi = Math.ceil(dimensionalWeight);
    const selectedRate = selectedBarem
      ? null
      : data.rates.find(
          (item) =>
            item.carrier === carrier && Number(item.desi_kg) === roundedDesi,
        );
    const selectedPackaging = data.packaging.find(
      (item) =>
        roundedDesi >= Number(item.min_desi) &&
        roundedDesi <= Number(item.max_desi),
    );
    const shippingCost = selectShippingCost({
      salePrice,
      desi: dimensionalWeight,
      barems: data.barems,
      costs: data.rates,
      carrier,
    });
    const packagingCost = selectPackagingCost(
      dimensionalWeight,
      data.packaging,
    );
    const warnings = [];
    if (!selectedBarem && !selectedRate) warnings.push("SHIPPING_RATE_MISSING");
    if (!selectedPackaging) warnings.push("PACKAGING_RULE_MISSING");
    return {
      salePrice,
      desi: dimensionalWeight,
      roundedDesi,
      carrier,
      marketplace,
      shippingSource: selectedBarem ? "BAREM" : selectedRate ? "DESI" : "NONE",
      shippingCost,
      packagingCost,
      totalFulfillmentCost: integerToDecimal(
        decimalToInteger(shippingCost, 2) + decimalToInteger(packagingCost, 2),
        2,
      ),
      selectedBarem: selectedBarem || null,
      selectedRate: selectedRate || null,
      selectedPackaging: selectedPackaging || null,
      warnings,
    };
  }

  async coverage(marketplace = "TRENDYOL") {
    const data = await this.costs.shipping(marketplace);
    const carriers = [...new Set(data.rates.map((item) => item.carrier))].map(
      (carrier) => {
        const desiValues = data.rates
          .filter((item) => item.carrier === carrier)
          .map((item) => Number(item.desi_kg));
        const maximum = Math.max(...desiValues, 0);
        const present = new Set(desiValues);
        const missingDesi = [];
        for (let value = 0; value <= maximum; value++)
          if (!present.has(value)) missingDesi.push(value);
        return { carrier, maximumDesi: maximum, missingDesi };
      },
    );
    return {
      carriers,
      packagingRuleCount: data.packaging.length,
      warnings: carriers.flatMap((item) =>
        item.missingDesi.map((desi) => ({
          code: "MISSING_DESI_RATE",
          carrier: item.carrier,
          desi,
        })),
      ),
    };
  }
}

module.exports = { ShippingService };
