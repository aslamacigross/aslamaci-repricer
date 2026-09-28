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
            marketplace: "TRENDYOL",
            barcode: "8690609598109",
            cost_item_code: "YUMUSATICI_ACTISOFT_1500ML",
            quantity: 1,
          },
        ],
      }),
    );
  });

  test("mapping ekranında Rossmann fiyat havuzu sekmesi açılır", async () => {
    const user = userEvent.setup();
    render(<Costs mode="mappings" notify={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: /Rossmann havuzu/ }),
    );
    expect(
      await screen.findByPlaceholderText("Rossmann ürün veya marka ara"),
    ).toBeVisible();
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

  test("veri bütünlüğü merkezi adayları açıklayıp otomatik düzeltme yapmaz", async () => {
    const user = userEvent.setup();
    get.mockImplementation(async (path) => {
      if (path.startsWith("/api/cost-integrity/review"))
        return {
          data: {
            summary: {
              parallel_groups: 30,
              orphan_mappings: 2,
              orphan_legacy_links: 2,
              source_anomalies: 9,
              manual_live_candidates: 107,
              duplicate_candidates: 13,
            },
            definitions: {
              parallel:
                "Aynı tedarikçi kaydı birden fazla legacy maliyet bağlantısında görünüyor.",
            },
            category: "parallel",
            page: 1,
            limit: 25,
            total: 1,
            items: [
              {
                type: "parallel",
                supplier_offer_id: 12,
                supplier_code: "BIM",
                supplier_product_name: "Mr. Green Beyaz Sabun",
                current_price: 50,
                availability: "AVAILABLE",
                legacy_link_count: 2,
                legacy_links: [
                  {
                    legacyLinkId: 1,
                    costItemId: 101,
                    costItemCode: "MR_GREEN",
                    itemName: "Mr. Green Beyaz Sabun",
                    unitCost: 50,
                    mappingCount: 3,
                    trendyolMappings: 2,
                    hbMappings: 1,
                    selected: true,
                  },
                  {
                    legacyLinkId: 2,
                    costItemId: 102,
                    costItemCode: "ACTISOFT",
                    itemName: "Actisoft Beyaz Sabun",
                    unitCost: 45,
                    mappingCount: 1,
                    trendyolMappings: 1,
                    hbMappings: 0,
                    selected: false,
                  },
                ],
              },
            ],
          },
        };
      return { items: [] };
    });

    render(<Costs mode="costs" notify={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: /Veri Bütünlüğü/ }),
    );

    expect(
      await screen.findByText("İnsan onaylı veri bütünlüğü merkezi"),
    ).toBeVisible();
    expect(screen.getByText(/BİM Mr\. Green ≠ FILE Actisoft/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Paralel bağlantılar\s+30/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Orphan mapping\s+2/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Orphan supplier link\s+2/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Kaynak problemi\s+9/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Manual → Live adayları\s+107/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Duplicate adayları\s+13/ }),
    ).toBeVisible();
    expect(screen.getByText(/Mr\. Green Beyaz Sabun/)).toBeVisible();
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("/api/cost-integrity/review?"),
    );

    await user.click(screen.getByRole("button", { name: "İncele" }));
    expect(screen.getByText("Güvenli çözüm yolları")).toBeVisible();
    expect(
      screen.getByText(/Mevcut 1→1 replace önizlemesi kullanılır/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Şimdilik dokunma" }),
    ).toBeVisible();
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();

    post.mockResolvedValueOnce({
      data: {
        operationType: "REPLACE_COST_ITEM",
        payload: { sourceCostItemId: 102, targetCostItemId: 101 },
        previewFingerprint: "integrity-preview",
        impact: {
          mappingCount: 4,
          marketplaceCounts: { TRENDYOL: 3, HEPSIBURADA: 1 },
        },
        warnings: [],
      },
    });
    await user.click(screen.getByRole("button", { name: "Etki önizle" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/cost-integrity/preview", {
        operationType: "REPLACE_COST_ITEM",
        payload: { sourceCostItemId: 102, targetCostItemId: 101 },
      }),
    );
    expect(screen.getByText("Etki önizlemesi")).toBeVisible();
    expect(
      screen.getByText("Tüm mappingleri başka maliyet kalemine taşı"),
    ).toBeVisible();
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
        marketplace: "TRENDYOL",
      }),
    );
  });
});

describe("Kargo pazaryeri ayrımı", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (path) => {
      if (path.startsWith("/api/shipping/coverage"))
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
    const { rerender } = render(
      <Costs mode="shipping" notify={vi.fn()} marketplace="TRENDYOL" />,
    );

    expect(await screen.findByText(/501 tarife/)).toBeVisible();
    expect(screen.getByText("Sepet baremleri")).toBeVisible();
    expect(screen.getByText("Kargo maliyeti hesapla")).toBeVisible();

    rerender(
      <Costs mode="shipping" notify={vi.fn()} marketplace="HEPSIBURADA" />,
    );

    expect(await screen.findByText(/49\.511 tarife/)).toBeVisible();
    expect(
      screen.getByText("Hepsiburada anlaşmalı kargo tarifesi"),
    ).toBeVisible();
    expect(screen.getByText("Sepet baremleri")).toBeVisible();
    expect(screen.getByText("Kargo maliyeti hesapla")).toBeVisible();
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("marketplace=HEPSIBURADA"),
    );
  });

  test("boş Hepsiburada tarifesini panelden güvenli içe aktarır", async () => {
    const user = userEvent.setup();
    get.mockImplementation(async (path) => {
      if (path.startsWith("/api/shipping/coverage"))
        return { data: { warnings: [], carriers: [] } };
      const hepsiburada = path.includes("marketplace=HEPSIBURADA");
      return {
        data: {
          marketplace: hepsiburada ? "HEPSIBURADA" : "TRENDYOL",
          rates: [],
          barems: [],
          packaging: [],
          carriers: [],
          pagination: { page: 1, limit: 50, total: 0 },
        },
      };
    });
    post.mockResolvedValue({ data: { successful: 49511, metadata: {} } });

    render(
      <Costs mode="shipping" notify={vi.fn()} marketplace="HEPSIBURADA" />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Tarifeyi yükle" }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/shipping/hepsiburada/import", {
        force: false,
      }),
    );
  });
});
