import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
    render(<MappingSuggestions view="suggestions" notify={vi.fn()} />);
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
  });
});
