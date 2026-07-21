import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, post } from "../lib/api";
import ContentCenter from "./ContentCenter";

vi.mock("../lib/api", () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

const draft = {
  id: 6, recipe_name: "Actisoft Menekşe 1,5 L x 4", marketplace: "TRENDYOL",
  provider_mode: "MOCK_DRAFT", workflow_status: "AI_DRAFT",
  safety_errors: [], safety_warnings: ["BRAND_NOT_IN_TITLE"],
  current_content: { title: "Eski başlık", description: "Eski açıklama" },
  proposed_content: {
    title: "Actisoft Menekşe 1,5 L x 4", description: "Doğrulanmış içerik",
    searchTerms: "actisoft menekşe", visualBriefs: [{ type: "MAIN", brief: "4 gerçek paket" }],
  },
  diff_json: [{ field: "title", current: "Eski başlık", proposed: "Actisoft Menekşe 1,5 L x 4" }],
  snapshots: [{ id: 11, snapshot_type: "CURRENT", created_at: "2026-07-21T12:00:00Z", content_json: { title: "Eski başlık" } }],
};

const health = {
  id: 3, recipe_name: "Actisoft Menekşe 1,5 L x 4", title: "Menekşe Yumuşatıcı",
  seller_listing_barcode: "TY-MENEKSE", quality_score: 58, confidence: "HIGH",
  publication_state: "PUBLISHED", summary: "2 doğrulanabilir iyileştirme alanı bulundu",
  checks_json: [{
    code: "PACK_COUNT_MISSING", label: "Paket adedi", status: "ISSUE", penalty: 12,
    evidence: { expected: 4 }, recommendation: "Paket adedini başlığa ekleyin",
    expectedImpact: "İçerik açıklığını artırabilir", kpi: "yanlış beklenti/iade",
  }],
  data_quality: { missing: ["conversionRate"] },
};

describe("İçerik Stüdyosu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (path) => path === "/api/content-drafts/6"
      ? { data: draft }
      : { items: [draft], total: 1, page: 1, limit: 50 });
  });

  test("mevcut/önerilen diff, kaynak briefi ve güvenlik uyarısını gösterir", async () => {
    const user = userEvent.setup();
    render(<ContentCenter mode="content-studio" marketplace="TRENDYOL" notify={vi.fn()} />);
    await user.click(await screen.findByText("Actisoft Menekşe 1,5 L x 4"));
    expect((await screen.findAllByText("Eski başlık"))[0]).toBeVisible();
    expect(screen.getByText("4 gerçek paket")).toBeVisible();
    expect(screen.getByText("BRAND_NOT_IN_TITLE")).toBeVisible();
    expect(screen.getByText("Canlı güncelleme kapalı")).toBeVisible();
  });

  test("taslak üretimi reçete ve pazaryeriyle açık onay ister", async () => {
    post.mockResolvedValue({ data: { provider: { mode: "MOCK_DRAFT" } } });
    const user = userEvent.setup();
    render(<ContentCenter mode="content-studio" marketplace="TRENDYOL" notify={vi.fn()} />);
    await user.type(await screen.findByLabelText("PIM reçete ID"), "42");
    await user.click(screen.getByRole("button", { name: "Taslak üret" }));
    await user.click(screen.getAllByRole("button", { name: "Taslak üret" }).at(-1));
    expect(post).toHaveBeenCalledWith("/api/content-drafts/generate", {
      recipeId: 42, marketplace: "TRENDYOL", confirmation: "ICERIK_TASLAGI_URET",
    });
  });
});

describe("Listing Sağlığı", () => {
  test("sorun kanıtını, öneriyi ve ölçülecek KPI'yı açıklar", async () => {
    get.mockImplementation(async (path) => path === "/api/listing-health/3"
      ? { data: health }
      : { items: [health], total: 1, page: 1, limit: 50 });
    const user = userEvent.setup();
    render(<ContentCenter mode="listing-health" marketplace="TRENDYOL" notify={vi.fn()} />);
    await user.click(await screen.findByText("Menekşe Yumuşatıcı"));
    expect(await screen.findByText("Paket adedi")).toBeVisible();
    expect(screen.getByText("Paket adedini başlığa ekleyin")).toBeVisible();
    expect(screen.getByText(/yanlış beklenti\/iade/)).toBeVisible();
    expect(screen.getByText("conversionRate")).toBeVisible();
  });
});
