import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, post } from "../lib/api";
import Integrations from "./Integrations";

vi.mock("../lib/api", () => ({ get: vi.fn(), post: vi.fn() }));

describe("Entegrasyonlar sayfası", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({
      items: [
        {
          code: "TRENDYOL",
          display_name: "Trendyol",
          enabled: true,
          adapter_status: "READY",
          credentials_configured: true,
          capabilities: { supportsOrders: true, supportsBuybox: true },
          default_carrier: "TEX",
          default_service_fee_minor: 1319,
          currency: "TRY",
          timezone: "Europe/Istanbul",
        },
        {
          code: "HEPSIBURADA",
          display_name: "Hepsiburada",
          enabled: true,
          adapter_status: "WAITING_CREDENTIALS",
          credentials_configured: false,
          capabilities: { supportsOrders: true, supportsBuybox: false },
          runtime: { environment: "sit", mutationsEnabled: false },
          default_carrier: "hepsiJET",
          default_service_fee_minor: 1050,
          currency: "TRY",
          timezone: "Europe/Istanbul",
        },
      ],
    });
  });

  test("credential ve capability durumlarını secret göstermeden sunar", async () => {
    const user = userEvent.setup();
    get.mockImplementation((path) =>
      path === "/api/integrations/hepsiburada/sit-tests"
        ? Promise.resolve({
            data: {
              safety: {
                environment: "sit",
                sitOnly: true,
                mutationsLocked: true,
                publicWebhookUrl:
                  "https://preview.test/api/public/hepsiburada/webhook",
              },
              blockedReasons: [],
              steps: [
                {
                  code: "catalog",
                  title: "Katalog ürün testi",
                  status: "DRY_RUN_READY",
                  description: "Test katalog paketi hazırlanır.",
                },
              ],
            },
          })
        : Promise.resolve({
            items: [
              {
                code: "TRENDYOL",
                display_name: "Trendyol",
                enabled: true,
                adapter_status: "READY",
                credentials_configured: true,
                capabilities: { supportsOrders: true, supportsBuybox: true },
                default_carrier: "TEX",
                default_service_fee_minor: 1319,
                currency: "TRY",
                timezone: "Europe/Istanbul",
              },
              {
                code: "HEPSIBURADA",
                display_name: "Hepsiburada",
                enabled: true,
                adapter_status: "WAITING_CREDENTIALS",
                credentials_configured: false,
                capabilities: { supportsOrders: true, supportsBuybox: false },
                runtime: { environment: "sit", mutationsEnabled: false },
                default_carrier: "hepsiJET",
                default_service_fee_minor: 1050,
                currency: "TRY",
                timezone: "Europe/Istanbul",
              },
            ],
          }),
    );
    render(<Integrations notify={vi.fn()} />);
    expect(await screen.findByText("Trendyol")).toBeVisible();
    expect(screen.getByText("Hepsiburada")).toBeVisible();
    expect(screen.getByText("Kimlik bekliyor")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "Detaylar" })[1]);
    expect(await screen.findByText("Capability sözleşmesi")).toBeVisible();
    expect(screen.getAllByText("Buybox").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mutasyon kilidi").length).toBeGreaterThan(0);
    expect(
      await screen.findByText("Hepsiburada SIT test merkezi"),
    ).toBeVisible();
    expect(await screen.findByText("Katalog ürün testi")).toBeVisible();
  });

  test("bağlantı testini merkezi endpoint üzerinden yapar", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    post.mockResolvedValue({ message: "Trendyol bağlantısı doğrulandı" });
    render(<Integrations notify={notify} />);
    await user.click(
      (await screen.findAllByRole("button", { name: "Bağlantıyı test et" }))[0],
    );
    expect(post).toHaveBeenCalledWith("/api/integrations/TRENDYOL/test");
  });
});
