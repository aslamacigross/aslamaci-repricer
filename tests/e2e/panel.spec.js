const { test, expect } = require("@playwright/test");

async function login(page) {
  await page.goto("/");
  await page.getByLabel("Parola").fill("demo12345678");
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

test("admin panel ana operasyon akışı", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Yönetim paneli" }),
  ).toBeVisible();
  await page.getByLabel("Parola").fill("demo12345678");
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(
    page.getByRole("heading", { name: "Genel Bakış" }),
  ).toBeVisible();
  await expect(page.getByText("Dry-run", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ürünler" }).click();
  await expect(page.getByRole("heading", { name: "Ürünler" })).toBeVisible();
  await page.getByPlaceholder("Barkod veya ürün ara").fill("8690609598109");
  await page.getByText("Menekşe Konsantre", { exact: false }).click();
  await expect(
    page.locator(".drawer").getByText("₺312,28", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Kapat", exact: true }).click();

  await page.getByRole("button", { name: "Buybox", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Buybox" })).toBeVisible();
  await page.getByText("Hipoalerjenik Çiçek Rüyası", { exact: false }).click();
  await expect(
    page.getByText("buybox geçmişi", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Kapat", exact: true }).click();

  await page.getByRole("button", { name: "Fiyat Aksiyonları" }).click();
  await expect(
    page.getByRole("heading", { name: "Fiyat Aksiyonları" }),
  ).toBeVisible();
  await page.getByLabel("Fiyatı düzenle ve onayla").click();
  await expect(
    page.getByRole("heading", { name: "Fiyatı düzenle ve onayla" }),
  ).toBeVisible();
});

test("mobil menü ve ürün listesi", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByLabel("Menüyü aç").click();
  await page.getByRole("button", { name: "Ürünler" }).click();
  await expect(page.getByRole("heading", { name: "Ürünler" })).toBeVisible();
  await expect(page.getByPlaceholder("Barkod veya ürün ara")).toBeVisible();
});

test("toplu maliyet, CSV ve öğrenme detayı", async ({ page }) => {
  await login(page);
  await expect(page.getByText("DRY-RUN AÇIK", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Maliyet Kalemleri" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByLabel("CSV dışa aktar").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("costs-TRENDYOL-costs.csv");

  await page.getByRole("button", { name: "Toplu maliyet" }).click();
  await page
    .locator(".modal textarea")
    .fill("TEST_KALEM;Test maliyet kalemi;10.25;1;adet;E2E dry-run kaydı");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Kayıt başarıyla kaydedildi")).toBeVisible();

  await page.getByRole("button", { name: "Öğrenme Merkezi" }).click();
  await page.getByRole("row").nth(1).click();
  await expect(page.getByText("Önerilen sonraki adım")).toBeVisible();
  await expect(page.getByText("Son fiyat denemeleri")).toBeVisible();
});

test("akıllı mapping önerisini inceleme ve güvenli onay", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Ürün Mapping" }).click();
  await page.getByRole("button", { name: "Akıllı öneriler" }).click();

  await expect(
    page.getByRole("cell", {
      name: "Daycare Sir Ağda Bandı 20'li",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("%94")).toBeVisible();
  await page.getByRole("button", { name: "Öneriyi incele" }).click();
  await expect(page.getByText("Bu öneri neden geldi?")).toBeVisible();
  await page.getByRole("button", { name: "Öneriyi onayla" }).click();
  await expect(
    page.getByText("Öneri onaylandı; sıradaki öneriye geçebilirsiniz"),
  ).toBeVisible();
});

test("mobil akıllı mapping kuyruğu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByLabel("Menüyü aç").click();
  await page.getByRole("button", { name: "Ürün Mapping" }).click();
  await page.getByRole("button", { name: "Akıllı öneriler" }).click();

  await expect(
    page.getByPlaceholder("Barkod veya Trendyol ürünü ara"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Önerileri üret" }),
  ).toBeVisible();
  await expect(page.getByText("%94")).toBeVisible();
  if (process.env.VISUAL_QA)
    await page.screenshot({ path: "tmp/mapping-mobile.png", fullPage: true });
});

test("mobil BİM fiyat havuzu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByLabel("Menüyü aç").click();
  await page.getByRole("button", { name: "Ürün Mapping" }).click();
  await page.getByRole("button", { name: "BİM havuzu" }).click();

  await expect(page.getByPlaceholder("BİM ürün veya marka ara")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Canlı BİM'den yenile" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "BİM fiyatı içe aktar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "BİM Test Ürünü 250 g" }),
  ).toBeVisible();
  if (process.env.VISUAL_QA)
    await page.screenshot({
      path: "tmp/supplier-price-pool-mobile.png",
      fullPage: true,
    });
});

test("aylık satış ve kâr raporu masaüstü ve mobilde açılır", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Satış & Kâr" }).click();
  await expect(
    page.getByRole("heading", { name: "Satış & Kâr" }),
  ).toBeVisible();
  await expect(page.getByText("Sana aktarılacak")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Gider kırılımı" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Şehir dağılımı" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sipariş ve kargo desisi" }),
  ).toBeVisible();
  await expect(page.getByText("Faturalanan")).toBeVisible();
  await expect(page.getByText("Mapping tahmini")).toBeVisible();
  if (process.env.VISUAL_QA)
    await page.screenshot({
      path: "tmp/finance-desktop.png",
      fullPage: true,
    });

  await page.setViewportSize({ width: 390, height: 844 });
  const closeMenu = page.getByRole("button", { name: "Menüyü kapat" });
  if (await closeMenu.isVisible())
    await closeMenu.evaluate((element) => element.click());
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
  await page.waitForTimeout(300);
  await expect(
    page.getByRole("heading", { name: "Satış & Kâr" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  if (process.env.VISUAL_QA)
    await page.screenshot({
      path: "tmp/finance-mobile.png",
      fullPage: true,
    });
});

test("kargo tarifeleri pazaryerine göre ayrılır ve sayfalanır", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Kargo & Ambalaj" }).click();

  await expect(page.getByText("Trendyol · 501 tarife")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sepet baremleri" }),
  ).toBeVisible();
  await expect(page.getByText("Kargo maliyeti hesapla")).toBeVisible();

  await page.getByRole("button", { name: "Hepsiburada" }).click();
  await expect(page.getByText("Hepsiburada · 49.511 tarife")).toBeVisible();
  await expect(
    page.getByText("Hepsiburada anlaşmalı kargo tarifesi"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sepet baremleri" }).click();
  await expect(
    page.getByRole("cell", { name: "hepsiJET" }).first(),
  ).toBeVisible();
  await expect(page.getByText("Kargo maliyeti hesapla")).toBeVisible();

  await page.getByRole("button", { name: "Sistem Ayarları" }).click();
  await expect(page.getByLabel("Hepsiburada hizmet bedeli")).toHaveValue(
    "10.5",
  );
  await expect(page.getByLabel("Hepsiburada varsayılan kargo")).toHaveValue(
    "hepsiJET",
  );

  await page.getByRole("button", { name: "Repricer", exact: true }).click();
  await expect(
    page.getByText("Hepsiburada repricer bağlantısı bekleniyor"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Aksiyon oluştur" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Kargo & Ambalaj" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Kargo & Ambalaj" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  const mobileLayout = await page.evaluate(() => {
    const pageDocument = globalThis.document;
    const topbar = pageDocument
      .querySelector(".topbar")
      ?.getBoundingClientRect();
    const main = pageDocument
      .querySelector(".main-area main")
      ?.getBoundingClientRect();
    return {
      viewportWidth: globalThis.innerWidth,
      documentWidth: pageDocument.documentElement.scrollWidth,
      topbarBottom: topbar?.bottom || 0,
      mainTop: main?.top || 0,
    };
  });
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(
    mobileLayout.viewportWidth,
  );
  expect(mobileLayout.mainTop).toBeGreaterThanOrEqual(
    mobileLayout.topbarBottom,
  );
  if (process.env.VISUAL_QA) {
    await page.waitForTimeout(350);
    await page.screenshot({
      path: "tmp/shipping-mobile.png",
      fullPage: true,
    });
  }
});
