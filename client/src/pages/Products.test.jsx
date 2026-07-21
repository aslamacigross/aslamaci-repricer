import { describe, expect, test, vi } from "vitest";
import { fetchAllProducts } from "./Products";

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
