import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, post } from "../lib/api";
import MappingSuggestions from "./MappingSuggestions";

vi.mock("../lib/api", () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

const suggestion = {
  id: 14,
  barcode: "8690609598109",
  product_name: "Menekşe Konsantre Yumuşatıcı 1500 ml",
  category_name: "Yumuşatıcı",
  confidence: 0.96,
  confidence_band: "HIGH",
  status: "PENDING",
  source_type: "MANUAL_HISTORY_AND_FILE",
  source_barcode: "8690609598108",
  update_file_price: true,
  evidence: {
    sourceProductName: "Menekşe Yumuşatıcı 2 Adet",
    reasons: [{ code: "NAME_SIMILARITY", value: 0.95 }],
  },
  items: [
    {
      id: 1,
      cost_item_code: "YUMUSATICI_ACTISOFT_1500ML",
      item_name: "Actisoft Yumuşatıcı",
      quantity: 1,
      unit_cost: 110,
      unit_desi: 1.5,
      file_market_item_id: 7,
      file_product_name: "Actisoft Menekşe Bahçesi 1500 ml",
      file_current_price: 112,
    },
  ],
};

describe("Akıllı mapping paneli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (path) => {
      if (path.startsWith("/api/mapping-suggestions"))
        return {
          data: { items: [suggestion], total: 1, page: 1, limit: 50 },
        };
      return { data: { items: [], total: 0, page: 1, limit: 50 } };
    });
    post.mockResolvedValue({ data: { ...suggestion, status: "APPROVED" } });
  });

  test("Trendyol ürünü, File fiyatı ve güven skorunu birlikte gösterir", async () => {
    render(<MappingSuggestions view="suggestions" notify={vi.fn()} />);
    expect(
      await screen.findByText("Menekşe Konsantre Yumuşatıcı 1500 ml"),
    ).toBeVisible();
    expect(screen.getByText("Actisoft Menekşe Bahçesi 1500 ml")).toBeVisible();
    expect(screen.getByText("%96")).toBeVisible();
    expect(
      screen
        .getAllByText("Yüksek güven")
        .some((item) => item.tagName === "SPAN"),
    ).toBe(true);
  });

  test("onay öneriyi uygulatmadan yalnızca onay endpointini çağırır", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    render(<MappingSuggestions view="suggestions" notify={notify} />);
    await user.click(
      await screen.findByRole("button", { name: "Öneriyi incele" }),
    );
    await user.click(screen.getByRole("button", { name: "Öneriyi onayla" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/mapping-suggestions/14/approve",
        expect.objectContaining({ update_file_price: true }),
      ),
    );
    expect(post).not.toHaveBeenCalledWith(
      "/api/mapping-suggestions/bulk-apply",
      expect.anything(),
    );
    expect(notify).toHaveBeenCalledWith(
      "Öneri onaylandı; sıradaki öneriye geçebilirsiniz",
    );
  });

  test("onaylı öneriyi önizleyip gerçek mappinge uygular", async () => {
    const user = userEvent.setup();
    const approved = { ...suggestion, status: "APPROVED" };
    get.mockResolvedValue({
      data: { items: [approved], total: 1, page: 1, limit: 50 },
    });
    post.mockImplementation(async (path) => {
      if (path === "/api/mapping-suggestions/bulk-preview")
        return {
          data: {
            token: "preview-token",
            productCount: 1,
            mappingCount: 1,
            priceUpdateCount: 1,
            suggestions: [approved],
          },
        };
      if (path === "/api/mapping-suggestions/bulk-apply")
        return { data: { applied: 1 } };
      return { data: approved };
    });

    render(<MappingSuggestions view="suggestions" notify={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Mapping uygulama önizlemesi",
      }),
    );
    expect(await screen.findByText("Onaylı mappingleri uygula")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Mappingleri uygula" }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/mapping-suggestions/bulk-apply", {
        ids: [14],
        previewToken: "preview-token",
      }),
    );
  });

  test("seçili onaylı önerileri click eventi yerine id listesiyle önizler", async () => {
    const user = userEvent.setup();
    const approved = { ...suggestion, status: "APPROVED" };
    get.mockResolvedValue({
      data: { items: [approved], total: 1, page: 1, limit: 50 },
    });
    post.mockImplementation(async (path) => {
      if (path === "/api/mapping-suggestions/bulk-preview")
        return {
          data: {
            token: "preview-token",
            productCount: 1,
            mappingCount: 1,
            priceUpdateCount: 1,
            suggestions: [approved],
          },
        };
      return { data: approved };
    });

    render(<MappingSuggestions view="suggestions" notify={vi.fn()} />);
    await user.click(await screen.findByLabelText("Satırı seç"));
    await user.click(
      screen.getByRole("button", { name: /Seçilenleri önizle/ }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/mapping-suggestions/bulk-preview",
        {
          ids: [14],
        },
      ),
    );
  });

  test("kardeş varyant fiyatını tabloda ve detayda açıkça işaretler", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({
      data: {
        items: [
          {
            ...suggestion,
            confidence: 0.919,
            confidence_band: "REVIEW",
            evidence: {
              ...suggestion.evidence,
              variantPriceInferred: true,
              fileMatches: [
                {
                  costItemCode: "YUMUSATICI_ACTISOFT_1500ML",
                  priceMode: "SIBLING_VARIANT",
                },
              ],
            },
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
    });
    render(<MappingSuggestions view="suggestions" notify={vi.fn()} />);
    expect(await screen.findByText("Varyant fiyatı")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Öneriyi incele" }));
    expect(screen.getByText("Varyant fiyatından türetildi")).toBeVisible();
    expect(screen.getByText("Kardeş varyant fiyatı kullanıldı")).toBeVisible();
  });

  test("onay ve ret geri bildirimlerini karar geçmişinde gösterir", async () => {
    get.mockResolvedValue({
      data: {
        items: [
          {
            id: 22,
            created_at: "2026-07-15T01:00:00.000Z",
            barcode: "8690609598109",
            product_name: "Menekşe Konsantre Yumuşatıcı 1500 ml",
            decision: "APPROVED",
            confidence: 0.78,
            learning_adjustment: 0.025,
            accepted_count: 3,
            rejected_count: 1,
            actor: "admin",
            items: [{ cost_item_code: "YUMUSATICI_ACTISOFT_1500ML" }],
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
    });
    render(<MappingSuggestions view="learning" notify={vi.fn()} />);
    expect(await screen.findByText("Onaylandı")).toBeVisible();
    expect(screen.getByText("3 onay / 1 ret")).toBeVisible();
    expect(screen.getByText("+2,5 puan")).toBeVisible();
  });

  test("BİM katalog JSON'unu ayrı fiyat havuzuna aktarır", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    get.mockResolvedValue({
      data: { items: [], total: 0, page: 1, limit: 50 },
    });
    post.mockResolvedValue({ data: { processed: 1, changed: 0 } });

    render(<MappingSuggestions view="bim" notify={notify} />);
    await user.click(
      await screen.findByRole("button", { name: "BİM fiyatı içe aktar" }),
    );
    const rows = [
      {
        source_key: "bim-yemeksepeti:1",
        product_name: "BİM Test Ürünü 250 g",
        current_price: 49.9,
        brand: "Test",
        availability: "AVAILABLE",
      },
    ];
    fireEvent.change(screen.getByRole("textbox", { name: /BİM ürün adı/ }), {
      target: { value: JSON.stringify(rows) },
    });
    await user.click(
      screen.getByRole("button", { name: "Fiyatları içe aktar" }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/supplier-price-pools/BIM/items/bulk",
        { rows },
      ),
    );
  });

  test("teşhis satırından öneri üretir ve manuel kuyruğa alır", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    get.mockResolvedValue({
      data: {
        processed: 1,
        summary: { LOW_CONFIDENCE_AVAILABLE: 1 },
        items: [
          {
            barcode: "528528268",
            product_name: "Harras Filtre Kahve Seti",
            brand: "Harras",
            diagnosis: "LOW_CONFIDENCE_AVAILABLE",
            diagnosis_label: "Düşük güvenli öneri üretilebilir",
            best_file_product_name: "Harras Guatemala Filtre Kahve 250 g",
            best_file_price: 229,
            best_file_score: 0.52,
            confidence: 0.41,
            data_status: "MAPPING_MISSING",
          },
        ],
      },
    });
    post.mockImplementation(async (path) => {
      if (path.endsWith("/regenerate"))
        return { data: { barcode: "528528268", created: 1 } };
      if (path.endsWith("/manual-cost"))
        return { data: { barcode: "528528268" } };
      return { data: {} };
    });

    render(<MappingSuggestions view="diagnostics" notify={notify} />);
    expect(await screen.findByText("Harras Filtre Kahve Seti")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Öner" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/mapping-suggestions/diagnostics/528528268/regenerate",
        {},
      ),
    );
    await user.click(screen.getByRole("button", { name: "Manuel" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/mapping-suggestions/diagnostics/528528268/manual-cost",
        expect.objectContaining({
          reason: expect.stringContaining("Teşhis ekranından"),
        }),
      ),
    );
  });

  test("teşhis önerisi zaten onaylıysa yeni öneri yok demek yerine sebebini gösterir", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    get.mockResolvedValue({
      data: {
        processed: 1,
        summary: { SUGGESTION_AVAILABLE: 1 },
        items: [
          {
            barcode: "TYBGRQD9451MF7S999",
            product_name: "Doğal Beyaz Banyo Sabunu 4 X 200 Gr",
            brand: "Daycare",
            diagnosis: "SUGGESTION_AVAILABLE",
            diagnosis_label: "Öneri üretilebilir",
            best_file_product_name: "Daycare Kalıp Sabun 4x200 g",
            best_file_price: 69.5,
            best_file_score: 0.61,
            confidence: 0.57,
            data_status: "MAPPING_MISSING",
          },
        ],
      },
    });
    post.mockResolvedValue({
      data: {
        barcode: "TYBGRQD9451MF7S999",
        created: 0,
        skippedApproved: 1,
        reason: "APPROVED_EXISTS",
      },
    });

    render(<MappingSuggestions view="diagnostics" notify={notify} />);
    expect(
      await screen.findByText("Doğal Beyaz Banyo Sabunu 4 X 200 Gr"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Öner" }));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "TYBGRQD9451MF7S999 için onaylı öneri zaten var; Onaylananlar filtresinden mappinge uygulayabilirsiniz",
        "warning",
      ),
    );
  });
});
