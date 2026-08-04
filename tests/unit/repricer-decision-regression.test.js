const test = require("node:test");
const assert = require("node:assert/strict");
const {
  proposePrice,
  safetyCheck,
  campaignEconomics,
} = require("../../src/domain/repricer");

const now = () => new Date().toISOString();
const baseProduct = {
  is_active: true,
  on_sale: true,
  locked: false,
  stock_quantity: 10,
  data_complete: true,
  commission_rate: 17,
  calculated_net_profit: 100,
  calculated_product_cost: 100,
  calculated_shipping_cost: 20,
  packaging_cost: 10,
  service_fee: 5,
  auto_update: true,
  buybox_updated_at: now(),
};
const baseSettings = {
  strategy: "Normal",
  price_cut_tl: 0.1,
  min_undercut_tl: 0.1,
  max_undercut_tl: 75,
  max_increase_tl: 10,
  max_single_change_pct: 15,
  max_daily_change_pct: 15,
  min_change_interval_minutes: 0,
  daily_action_limit: 3,
  auto_update: true,
  unlimited_increase: false,
};
const global = {
  repricerEnabled: true,
  dryRun: false,
  buyboxMaxAgeMinutes: 20,
  maxChangePct: 15,
  platformMinPriceChangeTl: 0.01,
};

function product(input) {
  return { ...baseProduct, ...input, buybox_updated_at: now() };
}

for (const scenario of [
  {
    name: "Mr.Green Lateks Eldiven",
    input: { my_price: 524.9, buybox_price: 524.69, min_price: 517.58, rank: 2 },
    expected: 524.59,
  },
  {
    name: "Pudra Oda Kokusu 4'lü",
    input: { my_price: 665.22, buybox_price: 664.83, min_price: 647.14, rank: 3 },
    expected: 664.73,
  },
  {
    name: "Çiçek Rüyası Yumuşatıcı 2'li",
    input: { my_price: 502.1, buybox_price: 501.27, min_price: 499.46, rank: 2 },
    expected: 501.17,
  },
  {
    name: "Ceviz İçi 4 x 400 gr",
    input: { my_price: 2310.02, buybox_price: 2286.92, min_price: 1562.02, rank: 2 },
    expected: 2286.82,
  },
]) {
  test(`${scenario.name} buybox fiyatının yalnızca 0,10 TL altını hedefler`, () => {
    const proposal = proposePrice(product(scenario.input), baseSettings);
    assert.equal(proposal.action, "FIYAT_DUSUR");
    assert.equal(proposal.proposedPrice, scenario.expected);
    assert.equal(proposal.targetRank, 1);
  });
}

test("Güneş Sıvı Sabun ekonomik olmayan buybox hedefini reddeder", () => {
  const proposal = proposePrice(
    product({
      my_price: 334.8,
      buybox_price: 333.87,
      min_price: 334.8,
      rank: 2,
    }),
    baseSettings,
  );
  assert.equal(proposal.action, "KORU");
  assert.equal(proposal.proposedPrice, 334.8);
  assert.equal(proposal.obstacle, "BUYBOX_NOT_ECONOMIC");
});

test("buybox fiyatından düşük olup sıra alamayan ürün fiyat değiştirmez", () => {
  const proposal = proposePrice(
    product({
      my_price: 1252.1,
      buybox_price: 1291.77,
      min_price: 900,
      rank: 2,
    }),
    baseSettings,
  );
  assert.equal(proposal.action, "KORU");
  assert.equal(proposal.obstacle, "BUYBOX_INCONSISTENT");
});

test("satıcı kuponu kampanya ayarlı minimum liste fiyatına eklenir", () => {
  const proposal = proposePrice(
    product({
      barcode: "445656456456456",
      my_price: 557.12,
      buybox_price: 512.7,
      min_price: 499.46,
      rank: 2,
      active_seller_discount: 30,
    }),
    baseSettings,
  );
  assert.equal(proposal.campaignAdjustedMinPrice, 529.46);
  assert.equal(proposal.action, "KORU");
  assert.equal(proposal.obstacle, "BUYBOX_NOT_ECONOMIC");
});

test("Trendyol finansmanlı indirim satıcı minimum fiyatını yükseltmez", () => {
  const economics = campaignEconomics(
    { active_seller_discount: 0, trendyol_funded_discount: 30 },
    {},
    512.6,
    499.46,
  );
  assert.equal(economics.campaignAdjustedMinPrice, 499.46);
  assert.equal(economics.sellerSettlementPrice, 512.6);
  assert.equal(economics.effectiveCustomerPrice, 482.6);
});

test("öğrenilmiş 0,10 TL artış değeri büyük piyasa düzeltmesini sınırlamaz", () => {
  const item = product({
    barcode: "86956877149877",
    my_price: 349.99,
    buybox_price: 349.99,
    second_price: 561,
    min_price: 250,
    rank: 1,
  });
  const settings = {
    ...baseSettings,
    learned_max_increase_tl: 0.1,
    max_increase_tl: 10,
    max_single_change_pct: 15,
  };
  const proposal = proposePrice(item, settings);
  assert.equal(proposal.action, "FIYAT_ARTIR");
  assert.equal(proposal.proposedPrice, 560);
  assert.equal(proposal.difference, 210.01);
  assert.equal(proposal.limitedBy, "BUYBOX_PIYASA_DUZELTMESI");
  const safety = safetyCheck({
    product: item,
    settings,
    global,
    proposal,
    today: { actionCount: 0, dayStartPrice: item.my_price },
  });
  assert.ok(!safety.failures.includes("CHANGE_TOO_SMALL"));
  assert.ok(!safety.failures.includes("MAX_INCREASE_LIMIT"));
});

test("rank 2 ve üzerindeki hiçbir otomatik karar fiyat artıramaz", () => {
  for (const rank of [2, 3, 4, 10]) {
    const proposal = proposePrice(
      product({
        my_price: 600,
        buybox_price: 550,
        second_price: 900,
        third_price: 1000,
        min_price: 580,
        rank,
      }),
      baseSettings,
    );
    assert.notEqual(proposal.action, "FIYAT_ARTIR");
  }

  const item = product({
    my_price: 500,
    buybox_price: 450,
    min_price: 300,
    rank: 2,
  });
  const unsafeIncrease = {
    ...proposePrice(item, baseSettings),
    action: "FIYAT_ARTIR",
    proposedPrice: 510,
    expectedProfit: 100,
    expectedMargin: 10,
  };
  const safety = safetyCheck({
    product: item,
    settings: baseSettings,
    global,
    proposal: unsafeIncrease,
    today: { actionCount: 0, dayStartPrice: 500 },
  });
  assert.ok(
    safety.failures.includes("RANK_OUTSIDE_BUYBOX_INCREASE_FORBIDDEN"),
  );
});

test("maliyet eksikse otomatik buybox düşüşü üretilmez", () => {
  const proposal = proposePrice(
    product({
      data_complete: false,
      my_price: 500,
      buybox_price: 450,
      min_price: 300,
      rank: 2,
    }),
    baseSettings,
  );
  assert.equal(proposal.action, "KORU");
  assert.equal(proposal.obstacle, "COST_INCOMPLETE");
});

test("0,01 TL geçerli fiyat değişikliği CHANGE_TOO_SMALL değildir", () => {
  const item = product({
    my_price: 100,
    buybox_price: 100,
    second_price: 101.01,
    min_price: 50,
    rank: 1,
  });
  const proposal = {
    ...proposePrice(item, baseSettings),
    proposedPrice: 100.01,
    difference: 0.01,
    actionDelta: 0.01,
    expectedProfit: 10,
    expectedMargin: 10,
  };
  const safety = safetyCheck({
    product: item,
    settings: baseSettings,
    global,
    proposal,
    today: { actionCount: 0, dayStartPrice: 100 },
  });
  assert.ok(!safety.failures.includes("CHANGE_TOO_SMALL"));
});
