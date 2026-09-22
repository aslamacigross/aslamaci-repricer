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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Akıllı mapping paneli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
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

  test("Hepsiburada seciliyken urun ve kimlik basliklarini dogru gosterir", async () => {
    render(
      <MappingSuggestions
        view="suggestions"
        marketplace="HEPSIBURADA"
        notify={vi.fn()}
      />,
    );

    expect(
      (await screen.findAllByText("Hepsiburada ürünü")).some(
        (item) => item.tagName === "BUTTON",
      ),
    ).toBe(true);
    expect(
      screen
        .getAllByText("Satıcı stok kodu")
        .some((item) => item.tagName === "BUTTON"),
    ).toBe(true);
    expect(screen.queryByText("Trendyol ürünü")).not.toBeInTheDocument();
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

  test("mapping suggestion drawer shared CostSelector kullanır", async () => {
    const user = userEvent.setup();
    render(<MappingSuggestions view="suggestions" notify={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: "Öneriyi incele" }),
    );
    await user.click(screen.getByText("Doğru maliyeti seç"));
    expect(await screen.findByTestId("shared-cost-selector")).toBeVisible();
  });

  test("mapping suggestion secilen canonical desiyi drawer icinde guvenle duzeltir", async () => {
    const user = userEvent.setup();
    get.mockImplementation(async (path) => {
      if (path.startsWith("/api/mapping-suggestions"))
        return {
          data: { items: [suggestion], total: 1, page: 1, limit: 50 },
        };
      if (path.includes("/api/supplier-price-pools/FILE_MARKET/items"))
        return {
          data: {
            items: [
              {
                id: 7,
                product_name: "Actisoft Menekşe Bahçesi 1500 ml",
                current_price: 112,
                supplier_code: "FILE_MARKET",
                availability: "AVAILABLE",
                offer_type: "LIVE",
                canonical_cost_item_id: 12,
                canonical_item_code: "YUMUSATICI_ACTISOFT_1500ML",
                linked_unit_desi: 1.5,
              },
            ],
            total: 1,
            page: 1,
            limit: 20,
          },
        };
      if (path.includes("/api/cost-integrity/cost-items/12/context"))
        return {
          data: {
            mappings: [
              { marketplace: "TRENDYOL", barcode: "8690609598109" },
              { marketplace: "HEPSIBURADA", barcode: "HB-8690609598109" },
            ],
          },
        };
      return { data: { items: [], total: 0, page: 1, limit: 20 } };
    });
    post.mockImplementation(async (path) =>
      path.includes("/desi-review/")
        ? {
            data: {
              id: 12,
              item_code: "YUMUSATICI_ACTISOFT_1500ML",
              unit_desi: 1.8,
            },
          }
        : { data: { ...suggestion, status: "APPROVED" } },
    );

    render(<MappingSuggestions view="suggestions" notify={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: "Öneriyi incele" }),
    );
    await user.click(screen.getByText("Doğru maliyeti seç"));
    await user.click(await screen.findByRole("button", { name: "Seç" }));
    const quantity = screen.getByLabelText("Adet");
    expect(quantity).toHaveValue(1);
    const unitDesi = await screen.findByLabelText("Canonical birim desi");
    expect(unitDesi).toHaveValue(1.5);
    await user.clear(unitDesi);
    await user.type(unitDesi, "1.8");
    await user.click(screen.getByRole("button", { name: "Desiyi güncelle" }));
    expect(await screen.findByText(/Trendyol: 1 mapping/)).toBeVisible();
    expect(screen.getByText(/Hepsiburada: 1 mapping/)).toBeVisible();
    await user.click(
      screen.getAllByRole("button", { name: "Desiyi güncelle" }).at(-1),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/cost-items/desi-review/YUMUSATICI_ACTISOFT_1500ML/resolve",
        { unit_desi: 1.8 },
      ),
    );
    expect(screen.getByLabelText("Adet")).toHaveValue(1);
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

  test("yanlışlıkla onaylanan önerinin onayını iptal eder", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    const approved = { ...suggestion, status: "APPROVED" };
    get.mockResolvedValue({
      data: { items: [approved], total: 1, page: 1, limit: 50 },
    });
    post.mockImplementation(async (path) => {
      if (path === "/api/mapping-suggestions/14/cancel-approval")
        return { data: { ...approved, status: "REJECTED" } };
      return { data: approved };
    });

    render(<MappingSuggestions view="suggestions" notify={notify} />);
    await user.click(
      await screen.findByRole("button", { name: "Öneriyi incele" }),
    );
    await user.click(screen.getByRole("button", { name: "Onayı iptal et" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/mapping-suggestions/14/cancel-approval",
        { reason: "Yanlışlıkla onaylandı" },
      ),
    );
    expect(notify).toHaveBeenCalledWith("Öneri onayı iptal edildi");
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

  test("BİM fiyat havuzunu canlı katalogdan yeniler", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    get.mockResolvedValue({
      data: { items: [], total: 0, page: 1, limit: 50 },
    });
    post.mockResolvedValue({
      data: {
        processed: 1147,
        created: 12,
        changed: 34,
        metadata: { productsScanned: 1360 },
      },
    });

    render(<MappingSuggestions view="bim" notify={notify} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Canlı BİM'den yenile",
      }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/supplier-price-pools/BIM/items/sync-live",
        {},
      ),
    );
    expect(notify).toHaveBeenCalledWith(
      "1147 BİM ürünü işlendi; 12 yeni, 34 fiyat değişikliği. 1360 ürün tarandı.",
    );
  });

  test("Bizim otomatik fiyat kademesini gösterir ama manuel edit açmaz", async () => {
    get.mockImplementation(async (path) => {
      if (path.includes("/duplicates")) return { data: { items: [] } };
      if (path.startsWith("/api/supplier-price-pools/BIZIM_MARKET/items"))
        return {
          data: {
            items: [
              {
                id: 7,
                source_key: "bizim-web:11770",
                product_name: "Halk UHT Süt 1 L",
                brand: "Halk",
                current_price: 44.9,
                price_tiers: [
                  { min_quantity: 12, unit_price: 42.9, label: "12+ adet" },
                ],
                raw_data: { price_tiers_source: "BIZIM_PRODUCT_DETAIL" },
              },
            ],
            total: 1,
            page: 1,
            limit: 50,
          },
        };
      return { data: { items: [], total: 0, page: 1, limit: 50 } };
    });

    render(<MappingSuggestions view="bizim" notify={vi.fn()} />);

    expect(await screen.findByText("Halk UHT Süt 1 L")).toBeVisible();
    expect(screen.getByText(/12\+/)).toBeVisible();
    expect(screen.getByText("Bizim Toptan'dan otomatik")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Fiyat kademelerini düzenle" }),
    ).not.toBeInTheDocument();
  });

  test.each([
    {
      firstView: "file",
      firstCode: "FILE_MARKET",
      firstProduct: "Geciken File ürünü",
      secondView: "bizim",
      secondCode: "BIZIM_MARKET",
      secondProduct: "Güncel Bizim ürünü",
    },
    {
      firstView: "bizim",
      firstCode: "BIZIM_MARKET",
      firstProduct: "Geciken Bizim ürünü",
      secondView: "file",
      secondCode: "FILE_MARKET",
      secondProduct: "Güncel File ürünü",
    },
  ])(
    "$firstCode cevabı geç gelse de $secondCode havuzunu overwrite etmez",
    async ({
      firstView,
      firstCode,
      firstProduct,
      secondView,
      secondCode,
      secondProduct,
    }) => {
      const firstResponse = deferred();
      const secondResponse = deferred();
      get.mockImplementation((path) => {
        if (path.includes("/duplicates"))
          return Promise.resolve({ data: { items: [] } });
        if (path.startsWith(`/api/supplier-price-pools/${firstCode}/items`))
          return firstResponse.promise;
        if (path.startsWith(`/api/supplier-price-pools/${secondCode}/items`))
          return secondResponse.promise;
        return Promise.resolve({
          data: { items: [], total: 0, page: 1, limit: 50 },
        });
      });

      const { rerender } = render(
        <MappingSuggestions view={firstView} notify={vi.fn()} />,
      );
      await waitFor(() =>
        expect(get).toHaveBeenCalledWith(
          expect.stringContaining(
            `/api/supplier-price-pools/${firstCode}/items?`,
          ),
        ),
      );

      rerender(<MappingSuggestions view={secondView} notify={vi.fn()} />);
      await waitFor(() =>
        expect(get).toHaveBeenCalledWith(
          expect.stringContaining(
            `/api/supplier-price-pools/${secondCode}/items?`,
          ),
        ),
      );
      secondResponse.resolve({
        data: {
          items: [
            {
              id: 2,
              product_name: secondProduct,
              current_price: 20,
              availability: "AVAILABLE",
            },
          ],
          total: 1,
          page: 1,
          limit: 50,
        },
      });
      expect(await screen.findByText(secondProduct)).toBeVisible();

      firstResponse.resolve({
        data: {
          items: [
            {
              id: 1,
              product_name: firstProduct,
              current_price: 10,
              availability: "AVAILABLE",
            },
          ],
          total: 1,
          page: 1,
          limit: 50,
        },
      });
      await waitFor(() =>
        expect(screen.getByText(secondProduct)).toBeVisible(),
      );
      expect(screen.queryByText(firstProduct)).not.toBeInTheDocument();
    },
  );

  test("Rossmann havuzunda Card fiyat badge'i ve canlı kaynak linki görünür", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    get.mockResolvedValue({
      data: {
        items: [
          {
            id: 9,
            source_key: "rossmann-api:26",
            product_name: "Nivea Soft Krem 2'li",
            brand: "Nivea",
            current_price: 199,
            previous_price: 219,
            size_value: null,
            size_unit: null,
            last_seen_at: "2026-08-15T10:00:00.000Z",
            stale: false,
            source_url:
              "https://www.rossmann.com.tr/nivea-soft-krem-2-li-p-kt20100233",
            raw_data: {
              regular_price: 330,
              rossmann_card_price: 199,
              effective_price_type: "ROSSMANN_CARD",
            },
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
    });
    post.mockResolvedValue({
      data: {
        processed: 1,
        created: 0,
        changed: 0,
        metadata: { productsScanned: 1 },
      },
    });

    render(<MappingSuggestions view="rossmann" notify={notify} />);

    expect(await screen.findByText("Nivea Soft Krem 2'li")).toBeVisible();
    expect(screen.getByText("Rossmann Card")).toBeVisible();
    expect(screen.getByRole("link", { name: /Aç/ })).toHaveAttribute(
      "href",
      "https://www.rossmann.com.tr/nivea-soft-krem-2-li-p-kt20100233",
    );
    await user.click(
      screen.getByRole("button", { name: "Canlı Rossmann'den yenile" }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/supplier-price-pools/ROSSMANN/items/sync-live",
        {},
      ),
    );
  });

  test("Diğer maliyet havuzu manuel ürünleri ayrı tedarikçi koduyla aktarır", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    get.mockResolvedValue({
      data: { items: [], total: 0, page: 1, limit: 50 },
    });
    post.mockResolvedValue({ data: { processed: 1, changed: 0 } });

    render(<MappingSuggestions view="other" notify={notify} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Diğer fiyatı içe aktar",
      }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Diğer ürün adı/ }), {
      target: { value: "Manuel Tedarik Ürünü;25;Aşlamacı;AVAILABLE" },
    });
    await user.click(
      screen.getByRole("button", { name: "Fiyatları içe aktar" }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/supplier-price-pools/OTHER/items/bulk",
        {
          rows: [
            {
              product_name: "Manuel Tedarik Ürünü",
              current_price: "25",
              brand: "Aşlamacı",
              availability: "AVAILABLE",
            },
          ],
        },
      ),
    );
  });

  test("Diğer havuzu fiziki tedarikçi ve kontrol zamanıyla server-side filtrelenir", async () => {
    get.mockResolvedValue({
      data: { items: [], total: 0, page: 1, limit: 50 },
    });
    render(<MappingSuggestions view="other" notify={vi.fn()} />);
    await userEvent.selectOptions(
      await screen.findByLabelText("Fiziki tedarikçi filtresi"),
      "BIM",
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Kontrol zamanı filtresi"),
      "DUE",
    );
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        expect.stringContaining("physicalSupplierCode=BIM"),
      ),
    );
    expect(
      get.mock.calls.some(
        ([path]) => path.includes("freshness=DUE") && path.includes("supplier-price-pools/OTHER"),
      ),
    ).toBe(true);
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
        { marketplace: "TRENDYOL" },
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
