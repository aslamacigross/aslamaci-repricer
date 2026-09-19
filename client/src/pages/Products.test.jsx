import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { get } from "../lib/api";
import { CostBreakdown, fetchAllProducts } from "./Products";

vi.mock("../lib/api", () => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
}));

describe("Ürün CSV dışa aktarımı", () => {
  test("API istenen limiti küçültse bile bütün sayfaları toplar", async () => {
    const fetchPage = vi.fn(async (path) => {
      const query = new URL(path, "https://panel.test").searchParams;
      const page = Number(query.get("page"));
      const start = (page - 1) * 200;
      return {
        items: Array.from(
          { length: Math.min(200, 450 - start) },
          (_, index) => ({ barcode: String(start + index + 1) }),
        ),
        total: 450,
        page,
        limit: 200,
      };
    });

    const items = await fetchAllProducts(
      { search: "Menekşe", page: 1, limit: 50 },
      fetchPage,
    );

    expect(items).toHaveLength(450);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls[1][0]).toContain("page=2");
    expect(fetchPage.mock.calls[2][0]).toContain("page=3");
    expect(fetchPage.mock.calls[2][0]).toContain("search=Menek%C5%9Fe");
  });
});

describe("Products maliyet yönetimi", () => {
  test("product drawer shared CostSelector kullanır", async () => {
    get.mockImplementation(async (path) => {
      if (path.includes("/context"))
        return {
          data: {
            costItem: { id: 1, item_name: "Maliyet", unit_cost: 50 },
            mappings: [],
            supplierOffers: [],
            hardDeleteEligibility: { eligible: false },
          },
        };
      return { data: { items: [], total: 0, page: 1, limit: 20 } };
    });
    render(
      <CostBreakdown
        marketplace="TRENDYOL"
        notify={vi.fn()}
        onChanged={vi.fn()}
        data={{
          product: {
            barcode: "ABC",
            calculated_product_cost: 50,
            calculated_shipping_cost: 20,
            packaging_cost: 2,
            service_fee: 5,
            target_profit: 40,
            commission_rate: 20,
            min_price: 146,
          },
          mappings: [
            {
              id: 3,
              cost_item_id: 1,
              item_name: "Maliyet",
              cost_item_code: "COST",
              unit_cost: 50,
              quantity: 1,
              line_cost: 50,
            },
          ],
        }}
      />,
    );
    expect(await screen.findByTestId("shared-cost-selector")).toBeVisible();
  });
});
