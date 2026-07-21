import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, post } from "../lib/api";
import PublishingCenter from "./PublishingCenter";

vi.mock("../lib/api", () => ({ get: vi.fn(), post: vi.fn() }));

describe("Ürün Yayınlama Merkezi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ items: [] });
  });

  test("yayın taslağını önce dry-run önizlemesine alır", async () => {
    const user = userEvent.setup();
    post.mockResolvedValueOnce({
      data: {
        pricing: {
          productCost: 112,
          shippingCost: 79,
          packagingCost: 15,
          serviceFee: 13.19,
          minimumPrice: 312.28,
          proposedPrice: 329.9,
          expectedNetProfit: 54.62,
          rankRecommendation: { targetRank: 2 },
        },
        blockers: ["MARKETPLACE_CREDENTIALS_MISSING"],
      },
    });
    render(<PublishingCenter mode="publishing" notify={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Yeni taslak" }));
    await user.type(screen.getByLabelText("Reçete ID"), "9");
    await user.selectOptions(screen.getByLabelText("Hedef pazaryeri"), "HEPSIBURADA");
    await user.click(screen.getByRole("button", { name: "Önizle" }));
    expect(await screen.findByText("₺312,28")).toBeVisible();
    expect(screen.getByText("MARKETPLACE_CREDENTIALS_MISSING")).toBeVisible();
    expect(post).toHaveBeenCalledWith(
      "/api/publication-drafts/preview",
      expect.objectContaining({ recipeId: 9, targetMarketplace: "HEPSIBURADA" }),
    );
  });

  test("kanal aktarımı kaynak, hedef ve reçete listesiyle başlatılır", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: { total_count: 2 } });
    render(<PublishingCenter mode="channel-transfer" notify={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Kanala kopyala" }));
    await user.type(screen.getByPlaceholderText("12, 13, 14"), "12, 13");
    await user.click(screen.getByRole("button", { name: "Önizlemeyi başlat" }));
    expect(post).toHaveBeenCalledWith(
      "/api/channel-transfers",
      expect.objectContaining({
        sourceMarketplace: "TRENDYOL",
        targetMarketplace: "HEPSIBURADA",
        recipeIds: [12, 13],
      }),
    );
  });
});
