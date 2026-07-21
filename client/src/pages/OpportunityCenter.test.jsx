import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, post } from "../lib/api";
import OpportunityCenter from "./OpportunityCenter";

vi.mock("../lib/api", () => ({ get: vi.fn(), post: vi.fn() }));

const opportunity = {
  id: 8,
  opportunity_type: "MISSING_PACK_SIZE",
  target_marketplace: "TRENDYOL",
  workflow_status: "GENERATED",
  score: 74.5,
  confidence: "MEDIUM",
  catalog_status: "SEARCH_REQUIRED",
  listing_barcode_required: false,
  generation_reason: "Mevcut ürün ailesinde eksik paket adedi",
  proposed_recipe: {
    recipeName: "Menekşe Çamaşır Yumuşatıcısı 1,5 L x 3",
    components: [{ costItemCode: "ACTISOFT_MENEKSE_1500", quantity: 3 }],
  },
  economics_json: { productCost: 336, desi: 5 },
  signal_breakdown: [{
    key: "supplier_freshness", label: "Tedarikçi fiyat güncelliği",
    source: "SUPPLIER_POOL", value: 2, contribution: 10,
  }],
  data_quality: { missing: ["buyboxPrice"] },
  events: [],
};

describe("Ürün Fırsatları", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (path) => path === "/api/opportunities/8"
      ? { data: opportunity }
      : { items: [opportunity], total: 1, page: 1, limit: 50 });
  });

  test("puan katkısı, eksik veri ve reçete bileşenini drawerda açıklar", async () => {
    const user = userEvent.setup();
    render(<OpportunityCenter marketplace="TRENDYOL" notify={vi.fn()} />);
    await user.click(await screen.findByText("Menekşe Çamaşır Yumuşatıcısı 1,5 L x 3"));
    expect(await screen.findByText("Tedarikçi fiyat güncelliği")).toBeVisible();
    expect(screen.getByText("ACTISOFT_MENEKSE_1500")).toBeVisible();
    expect(screen.getByText("buyboxPrice")).toBeVisible();
    expect(screen.getByText("Henüz tahsis edilmez")).toBeVisible();
  });

  test("fırsat üretimi açık onayla ve seçili hedef pazaryeriyle çalışır", async () => {
    post.mockResolvedValue({ data: { generated: 4 } });
    const user = userEvent.setup();
    render(<OpportunityCenter marketplace="TRENDYOL" notify={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Fırsatları üret" }));
    await user.click(screen.getAllByRole("button", { name: "Fırsatları üret" }).at(-1));
    expect(post).toHaveBeenCalledWith("/api/opportunities/generate", {
      targetMarketplace: "TRENDYOL",
      confirmation: "FIRSATLARI_URET",
    });
  });

  test("ret nedeni açık onayla immutable karar geçmişine gönderilir", async () => {
    post.mockResolvedValue({ data: { ...opportunity, workflow_status: "REJECTED", rejection_reason: "Paketleme uygun değil" } });
    const user = userEvent.setup();
    render(<OpportunityCenter marketplace="TRENDYOL" notify={vi.fn()} />);
    await user.click(await screen.findByText("Menekşe Çamaşır Yumuşatıcısı 1,5 L x 3"));
    await user.click(await screen.findByRole("button", { name: "Reddet" }));
    expect(await screen.findByText("Fırsatı reddet")).toBeVisible();
    await user.type(screen.getByLabelText("Ret nedeni"), "Paketleme uygun değil");
    await user.click(screen.getAllByRole("button", { name: "Reddet" }).at(-1));
    expect(post).toHaveBeenCalledWith("/api/opportunities/8/reject", {
      reason: "Paketleme uygun değil",
      confirmation: "FIRSATI_REDDET",
    });
  });
});
