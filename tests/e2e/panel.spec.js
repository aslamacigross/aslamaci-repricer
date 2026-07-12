const { test, expect } = require("@playwright/test");

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
  await page.goto("/");
  await page.getByLabel("Parola").fill("demo12345678");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.getByLabel("Menüyü aç").click();
  await page.getByRole("button", { name: "Ürünler" }).click();
  await expect(page.getByRole("heading", { name: "Ürünler" })).toBeVisible();
  await expect(page.getByPlaceholder("Barkod veya ürün ara")).toBeVisible();
});
