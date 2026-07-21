import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, post } from "../lib/api";
import CatalogCenter from "./CatalogCenter";

vi.mock("../lib/api", () => ({ get: vi.fn(), post: vi.fn() }));

describe("Merkezi PIM ekranları", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("Ana Katalog cost code bağlı fiziksel ürünü gösterir", async () => {
    get.mockResolvedValue({
      items: [
        {
          id: 1,
          product_name: "Menekşe Yumuşatıcı 1,5 L",
          brand: "Actisoft",
          product_family: "Çamaşır Yumuşatıcısı",
          variant: "Menekşe",
          cost_item_code: "ACTISOFT_MENEKSE_1500",
          status: "ACTIVE",
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });
    render(<CatalogCenter mode="catalog" notify={vi.fn()} />);
    expect(await screen.findByText("Menekşe Yumuşatıcı 1,5 L")).toBeVisible();
    expect(screen.getByText("Pazaryerinden bağımsız")).toBeVisible();
  });

  test("reçete drawerında bileşen ve pazaryeri listingini ayırır", async () => {
    get.mockImplementation(async (path) => {
      if (path === "/api/pim/recipes/12")
        return {
          data: {
            id: 12,
            recipe_name: "Menekşe 1,5 L x 2",
            bundle_fingerprint: "abcdef1234567890",
            total_cost_minor: 22400,
            fractional_desi: 3,
            final_desi: 3,
            components: [
              {
                id: 1,
                product_name: "Menekşe Yumuşatıcı 1,5 L",
                cost_item_code: "ACTISOFT_MENEKSE_1500",
                quantity: 2,
                unit_cost: 112,
              },
            ],
            listings: [
              {
                id: 1,
                marketplace: "TRENDYOL",
                seller_listing_barcode: "8690609598109",
                publication_state: "PUBLISHED",
              },
            ],
          },
        };
      return {
        items: [
          {
            id: 12,
            recipe_code: "REC-MENEKSHE2",
            recipe_name: "Menekşe 1,5 L x 2",
            recipe_type: "PACK",
            component_count: 1,
            listing_count: 1,
            total_cost_minor: 22400,
            final_desi: 3,
            status: "REVIEW",
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
      };
    });
    const user = userEvent.setup();
    render(<CatalogCenter mode="recipes" notify={vi.fn()} />);
    await user.click(await screen.findByText("REC-MENEKSHE2"));
    expect(await screen.findByText("Bileşenler")).toBeVisible();
    expect(screen.getByText("8690609598109")).toBeVisible();
  });

  test("listing barkodu önizlemesi tahsisten önce açık onay gösterir", async () => {
    get.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
    post.mockResolvedValue({
      data: {
        barcode: "ASL-HEP-ABCDEF1234567890",
        existing: false,
        recipe: { recipe_name: "Menekşe 1,5 L x 2" },
      },
    });
    const user = userEvent.setup();
    render(<CatalogCenter mode="barcode-pool" notify={vi.fn()} />);
    await user.type(await screen.findByPlaceholderText("Reçete ID"), "12");
    await user.click(screen.getByRole("button", { name: "Barkodu önizle" }));
    expect(await screen.findByText("Listing barkodunu rezerve et")).toBeVisible();
    expect(post).toHaveBeenCalledWith("/api/listing-barcodes/preview", {
      marketplace: "HEPSIBURADA",
      recipeId: "12",
    });
    await waitFor(() =>
      expect(screen.getByText(/ASL-HEP-ABCDEF1234567890/)).toBeVisible(),
    );
  });
});
