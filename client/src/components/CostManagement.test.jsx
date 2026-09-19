import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, post } from "../lib/api";
import {
  CostAssignmentEditor,
  CostSelector,
  ImpactPreviewModal,
} from "./CostManagement";

vi.mock("../lib/api", () => ({ get: vi.fn(), post: vi.fn() }));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const offer = {
  id: 7,
  product_name: "Harras Filiz Çay 1 kg",
  current_price: 239,
  source_key: "FILE-7",
  supplier_code: "FILE_MARKET",
  offer_type: "LIVE",
  availability: "AVAILABLE",
  canonical_cost_item_id: 12,
  canonical_item_code: "HARRAS_FILIZ_1KG",
  last_seen_at: "2026-09-19T10:00:00Z",
};

describe("shared cost management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: { items: [offer], total: 1, page: 1, limit: 20 } });
  });

  test("shared selector supplier search ve seçim yapar", async () => {
    const onSelect = vi.fn();
    render(<CostSelector onSelect={onSelect} />);
    expect(await screen.findByText("Harras Filiz Çay 1 kg")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Seç" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    expect(get).toHaveBeenCalledWith(expect.stringContaining("limit=20"));
  });

  test("geç dönen File cevabı Bizim sonucunu overwrite etmez", async () => {
    const file = deferred();
    const bizim = deferred();
    get.mockImplementation((path) =>
      path.includes("FILE_MARKET") ? file.promise : bizim.promise,
    );
    render(<CostSelector onSelect={vi.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await userEvent.selectOptions(screen.getByLabelText("Tedarikçi"), "BIZIM_MARKET");
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    bizim.resolve({
      data: { items: [{ ...offer, id: 9, product_name: "Bizim ürünü" }], total: 1, page: 1, limit: 20 },
    });
    expect(await screen.findByText("Bizim ürünü")).toBeVisible();
    file.resolve({
      data: { items: [{ ...offer, product_name: "Geciken File ürünü" }], total: 1, page: 1, limit: 20 },
    });
    await waitFor(() => expect(screen.queryByText("Geciken File ürünü")).not.toBeInTheDocument());
    expect(screen.getByText("Bizim ürünü")).toBeVisible();
  });

  test("Diğer manual form zorunlu metadata ile preview payload üretir", async () => {
    const submit = vi.fn();
    render(<CostSelector onSelect={vi.fn()} onManualSubmit={submit} />);
    await userEvent.selectOptions(screen.getByLabelText("Tedarikçi"), "OTHER");
    await userEvent.click(screen.getByRole("button", { name: "Manuel maliyet oluştur" }));
    fireEvent.change(screen.getByLabelText("Ürün adı"), { target: { value: "Manuel ürün" } });
    fireEvent.change(screen.getByLabelText("Fiyat"), { target: { value: "79" } });
    await userEvent.selectOptions(screen.getByLabelText("Fiziki tedarikçi"), "BIM");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      itemName: "Manuel ürün",
      unitCost: 79,
      physicalSupplierCode: "BIM",
    }));
  });

  test("impact preview fingerprint apply kontratına gider ve undo görünür", async () => {
    const notify = vi.fn();
    get.mockImplementation(async (path) => {
      if (path.includes("/context")) return {
        data: {
          costItem: { id: 1, item_name: "Eski", unit_cost: 65 },
          mappings: [{ id: 3, marketplace: "TRENDYOL", barcode: "ABC", quantity: 2 }],
          supplierOffers: [],
          hardDeleteEligibility: { eligible: false },
        },
      };
      return { data: { items: [offer], total: 1, page: 1, limit: 20 } };
    });
    post.mockImplementation(async (path) => {
      if (path.endsWith("/preview")) return {
        data: {
          operationType: "REASSIGN_PRODUCT_COST",
          payload: { marketplace: "TRENDYOL", barcode: "ABC", sourceCostItemId: 1, targetCostItemId: 12, quantity: 2 },
          previewFingerprint: "fingerprint-1",
          impact: { mappingCount: 1, byMarketplace: { TRENDYOL: 1, HEPSIBURADA: 0 }, currentUnitCost: 65, targetUnitCost: 79 },
        },
      };
      return { data: { id: 88, operation_type: "REASSIGN_PRODUCT_COST" } };
    });
    render(
      <CostAssignmentEditor
        marketplace="TRENDYOL"
        barcode="ABC"
        mappings={[{ id: 3, cost_item_id: 1, item_name: "Eski", unit_cost: 65, quantity: 2 }]}
        notify={notify}
      />,
    );
    expect(await screen.findByText("Harras Filiz Çay 1 kg")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Seç" }));
    expect(await screen.findByText("İşlem önizlemesi")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/api/cost-integrity/apply",
      expect.objectContaining({
        previewFingerprint: "fingerprint-1",
        confirmedMappingCount: 1,
        idempotencyKey: expect.any(String),
      }),
    ));
    expect(await screen.findByRole("button", { name: "Geri al" })).toBeVisible();
  });

  test("split preview bütün mappingler atanmadığında UI tarafından reddedilir", async () => {
    const notify = vi.fn();
    get.mockImplementation(async (path) => path.includes("/context") ? {
      data: {
        costItem: { id: 1, item_name: "Kırmızı Mercimek Makarnası", unit_cost: 59.9 },
        mappings: [
          { id: 1, marketplace: "TRENDYOL", barcode: "FUSILLI", quantity: 2 },
          { id: 2, marketplace: "HEPSIBURADA", barcode: "PENNE", quantity: 3 },
        ],
        supplierOffers: [],
        hardDeleteEligibility: { eligible: false },
      },
    } : { data: { items: [offer], total: 1, page: 1, limit: 20 } });
    render(
      <CostAssignmentEditor
        marketplace="TRENDYOL"
        barcode="FUSILLI"
        mappings={[{ id: 1, cost_item_id: 1, item_name: "Kırmızı Mercimek Makarnası", quantity: 2 }]}
        notify={notify}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Mappingleri ayır" }));
    await userEvent.click(screen.getByRole("button", { name: "Ayırmayı önizle" }));
    expect(notify).toHaveBeenCalledWith(
      "Bütün ürünleri bir hedef maliyet kalemine atamalısınız.",
      "error",
    );
    expect(post).not.toHaveBeenCalled();
  });
});

test("impact modal quantity ve marketplace etkisini mobil-dostu içerikte gösterir", () => {
  render(
    <ImpactPreviewModal
      preview={{
        operationType: "SPLIT_COST_MAPPINGS",
        impact: {
          mappingCount: 2,
          byMarketplace: { TRENDYOL: 1, HEPSIBURADA: 1 },
          mappings: [{ id: 1, marketplace: "TRENDYOL", barcode: "FUSILLI", quantity: 2 }],
        },
      }}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(
    screen.getByText((_, node) => node?.textContent === "TRENDYOL · FUSILLI · 2 adet"),
  ).toBeVisible();
  expect(screen.getByText("Hepsiburada")).toBeVisible();
});
