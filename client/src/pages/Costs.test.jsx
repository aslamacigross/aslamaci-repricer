import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, post, patch } from "../lib/api";
import Costs from "./Costs";

vi.mock("../lib/api", () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

describe("Toplu mapping paneli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ items: [] });
    post.mockImplementation(async (path) => {
      if (path === "/api/mappings/preview")
        return {
          data: {
            valid: true,
            rows: [{ barcode: "8690609598109" }],
            products: [
              {
                barcode: "8690609598109",
                mapping_count: 1,
                product_cost: 112,
                desi: 1.5,
              },
            ],
          },
        };
      return { data: { replacedBarcodes: 1 } };
    });
  });

  test("önizleme yapılmadan kaydetmez ve barkod kapsamlı endpointi kullanır", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    render(<Costs mode="mappings" notify={notify} />);
    await user.click(
      await screen.findByRole("button", { name: "Toplu mapping" }),
    );
    const textarea = screen
      .getAllByRole("textbox")
      .find((element) => element.tagName === "TEXTAREA");
    await user.type(textarea, "8690609598109;YUMUSATICI_ACTISOFT_1500ML;1");
    await user.click(screen.getByRole("button", { name: "Önizle" }));
    expect(await screen.findByText("1 barkod, 1 mapping")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/mappings/bulk-upsert", {
        rows: [
          {
            barcode: "8690609598109",
            cost_item_code: "YUMUSATICI_ACTISOFT_1500ML",
            quantity: 1,
          },
        ],
      }),
    );
  });

  test("maliyet kalemlerini panelden toplu yükler", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    render(<Costs mode="costs" notify={notify} />);
    await user.click(
      await screen.findByRole("button", { name: "Toplu maliyet" }),
    );
    const textarea = screen
      .getAllByRole("textbox")
      .find((element) => element.tagName === "TEXTAREA");
    await user.type(
      textarea,
      "YUMUSATICI;Actisoft Yumuşatıcı;112;1.5;adet;Haftalık maliyet",
    );
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/cost-items/bulk", {
        rows: [
          {
            item_code: "YUMUSATICI",
            item_name: "Actisoft Yumuşatıcı",
            unit_cost: 112,
            unit_desi: 1.5,
            unit: "adet",
            note: "Haftalık maliyet",
          },
        ],
      }),
    );
  });

  test("tekli mapping kaydında adet alanına dokunulmasa bile 1 gönderir", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    get.mockResolvedValue({
      items: [
        {
          id: 8,
          barcode: "8697654365254",
          cost_item_code: "BEST_CHOICE_KAMP_SANDALYESI",
          quantity: null,
        },
      ],
    });
    patch.mockResolvedValue({ data: { id: 8 } });

    render(<Costs mode="mappings" notify={notify} />);
    await user.click(await screen.findByText("8697654365254"));
    await user.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/api/mappings/8", {
        id: 8,
        barcode: "8697654365254",
        cost_item_code: "BEST_CHOICE_KAMP_SANDALYESI",
        quantity: 1,
      }),
    );
  });
});

describe("Kargo pazaryeri ayrımı", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (path) => {
      if (path === "/api/shipping/coverage")
        return { data: { warnings: [], carriers: [] } };
      if (path.includes("marketplace=HEPSIBURADA"))
        return {
          data: {
            marketplace: "HEPSIBURADA",
            rates: [
              {
                id: 2,
                carrier: "Aras",
                desi_kg: 0,
                cost_ex_vat: 90,
                cost_inc_vat: 108,
              },
            ],
            barems: [],
            packaging: [],
            carriers: ["Aras"],
            pagination: { page: 1, limit: 50, total: 49511 },
          },
        };
      return {
        data: {
          marketplace: "TRENDYOL",
          rates: [
            {
              id: 1,
              carrier: "TEX",
              desi_kg: 0,
              cost_ex_vat: 77.54,
              cost_inc_vat: 93.05,
            },
          ],
          barems: [],
          packaging: [],
          carriers: ["TEX"],
          pagination: { page: 1, limit: 50, total: 501 },
        },
      };
    });
  });

  test("Trendyol ve Hepsiburada tarifelerini ayrı gösterir", async () => {
    const user = userEvent.setup();
    render(<Costs mode="shipping" notify={vi.fn()} />);

    expect(await screen.findByText(/501 tarife/)).toBeVisible();
    expect(screen.getByText("Sepet baremleri")).toBeVisible();
    expect(screen.getByText("Kargo maliyeti hesapla")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Hepsiburada" }));

    expect(await screen.findByText(/49\.511 tarife/)).toBeVisible();
    expect(
      screen.getByText("Hepsiburada anlaşmalı kargo tarifesi"),
    ).toBeVisible();
    expect(screen.queryByText("Sepet baremleri")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Kargo maliyeti hesapla"),
    ).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("marketplace=HEPSIBURADA"),
    );
  });
});
