const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  bundleFingerprint,
  catalogMatch,
  listingBarcodeCandidate,
} = require("../../src/domain/pim");

describe("PIM reçete fingerprint", () => {
  test("bileşen sırasından bağımsız ve deterministiktir", () => {
    const first = bundleFingerprint([
      { costItemCode: "MENEKSHE_1500", quantity: 2 },
      { costItemCode: "CICEK_RUYASI_1500", quantity: 1 },
    ]);
    const second = bundleFingerprint([
      { costItemCode: "CICEK_RUYASI_1500", quantity: 1 },
      { costItemCode: "MENEKSHE_1500", quantity: 2 },
    ]);
    assert.equal(first, second);
  });

  test("karma paket düz paketten ayrılır", () => {
    const mixed = bundleFingerprint([
      { costItemCode: "MENEKSHE_1500", quantity: 1 },
      { costItemCode: "CICEK_RUYASI_1500", quantity: 1 },
    ]);
    const plain = bundleFingerprint([
      { costItemCode: "MENEKSHE_1500", quantity: 2 },
    ]);
    assert.notEqual(mixed, plain);
  });
});

describe("Katalog eşleştirme", () => {
  const menekseTwo = {
    brand: "Actisoft",
    productFamily: "Menekşe Çamaşır Yumuşatıcısı",
    variant: "Menekşe",
    unitVolumeMl: 1500,
    packCount: 2,
  };

  test("Menekşe 1,5 L x 2 eş ürünü yüksek güvenle tanır", () => {
    const result = catalogMatch(menekseTwo, { ...menekseTwo });
    assert.equal(result.isMatch, true);
    assert.equal(result.level, "HIGH");
  });

  test("1,5 L x 2 ile 3 L x 1 aynı sayılmaz", () => {
    const result = catalogMatch(menekseTwo, {
      ...menekseTwo,
      unitVolumeMl: 3000,
      packCount: 1,
    });
    assert.equal(result.isMatch, false);
    assert.equal(result.status, "REJECTED");
  });

  test("varyant uyuşmazlığı eşleşmeyi engeller", () => {
    const result = catalogMatch(menekseTwo, {
      ...menekseTwo,
      variant: "Çiçek Rüyası",
    });
    assert.equal(result.isMatch, false);
  });

  test("adayda paket adedi eksikse yüksek güven vermez", () => {
    const result = catalogMatch(menekseTwo, {
      brand: menekseTwo.brand,
      productFamily: menekseTwo.productFamily,
      variant: menekseTwo.variant,
      unitVolumeMl: menekseTwo.unitVolumeMl,
    });
    assert.equal(result.level, "REVIEW");
    assert.equal(result.insufficientData, true);
    assert.deepEqual(result.missingRequired, ["packCount"]);
  });

  test("karma bundle bileşenleri birebir uyuşmalıdır", () => {
    const source = {
      brand: "Actisoft",
      productFamily: "Yumuşatıcı Karma Paket",
      components: [
        { costItemCode: "MENEKSHE_1500", quantity: 1 },
        { costItemCode: "CICEK_RUYASI_1500", quantity: 1 },
      ],
    };
    const result = catalogMatch(source, {
      ...source,
      components: [{ costItemCode: "MENEKSHE_1500", quantity: 2 }],
    });
    assert.equal(result.isMatch, false);
  });
});

test("listing barkodu aynı reçete için deterministiktir", () => {
  const first = listingBarcodeCandidate("HEPSIBURADA", 12, "abc");
  const second = listingBarcodeCandidate("HEPSIBURADA", 12, "abc");
  assert.equal(first, second);
  assert.match(first, /^ASL-HEP-[A-F0-9]{16}$/);
});
