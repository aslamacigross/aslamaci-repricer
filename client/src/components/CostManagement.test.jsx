import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, post } from "../lib/api";
import {
  CanonicalDesiEditor,
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
  linked_cost_item_name: "Harras Filiz Çay 1 kg",
  linked_unit_cost: 239,
  linked_unit_desi: 0.8,
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

  test("selector linked, unlinked eligible ve blocked offer aksiyonlarini ayirir", async () => {
    const create = vi.fn();
    get.mockResolvedValue({
      data: {
        items: [
          offer,
          {
            ...offer,
            id: 8,
            product_name: "XYZ Şampuan 700 ml",
            canonical_cost_item_id: null,
            linked_cost_item_name: null,
            selection_state: "UNLINKED_ELIGIBLE",
          },
          {
            ...offer,
            id: 9,
            product_name: "Eski XYZ Şampuan",
            canonical_cost_item_id: null,
            linked_cost_item_name: null,
            availability: "UNAVAILABLE",
            selection_state: "BLOCKED",
            selection_block_reason: "Bu supplier ürünü şu anda kullanılamıyor.",
          },
        ],
        total: 3,
        page: 1,
        limit: 20,
      },
    });
    render(
      <CostSelector
        onSelect={vi.fn()}
        onCreateFromOffer={create}
      />,
    );
    expect(await screen.findByText("XYZ Şampuan 700 ml")).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Seç" }).find((button) => !button.disabled),
    ).toBeTruthy();
    const createButton = screen.getByRole("button", {
      name: "Yeni maliyet kalemi oluştur ve seç",
    });
    expect(createButton).toBeEnabled();
    await userEvent.click(createButton);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8, selection_state: "UNLINKED_ELIGIBLE" }),
    );
    expect(screen.getByText("Bu supplier ürünü şu anda kullanılamıyor.")).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Seç" }).find((button) => button.disabled),
    ).toBeTruthy();
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
    await userEvent.click(screen.getByRole("button", { name: "Değişikliği önizle" }));
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

  test("unmapped bundle quantity 4 ile preview ve apply payloadini korur", async () => {
    const notify = vi.fn();
    const shampoo = {
      ...offer,
      id: 17,
      product_name: "Kepeğe Karşı Etkili Şampuan 700 ml",
      linked_cost_item_name: "Kepeğe Karşı Etkili Şampuan 700 ml",
      linked_unit_cost: 150,
      linked_unit_desi: 0.7,
      canonical_cost_item_id: 42,
    };
    get.mockResolvedValue({
      data: { items: [shampoo], total: 1, page: 1, limit: 20 },
    });
    post.mockImplementation(async (path, body) => {
      if (path.endsWith("/preview"))
        return {
          data: {
            operationType: body.operationType,
            payload: body.payload,
            previewFingerprint: "quantity-4-fingerprint",
            warnings: [],
            impact: {
              mappingCount: 1,
              byMarketplace: { TRENDYOL: 1, HEPSIBURADA: 0 },
              targetUnitCost: 150,
              targetQuantity: body.payload.quantity,
              targetLineCost: body.payload.quantity * 150,
              targetUnitDesi: 0.7,
              targetTotalDesi: body.payload.quantity * 0.7,
              targetEffectiveProductDesi: 3,
              mappings: [
                {
                  marketplace: "TRENDYOL",
                  barcode: "SHAMPOO-4X",
                  quantity: body.payload.quantity,
                },
              ],
            },
          },
        };
      return { data: { id: 91, operation_type: "ASSIGN_PRODUCT_COST" } };
    });
    render(
      <CostAssignmentEditor
        marketplace="TRENDYOL"
        barcode="SHAMPOO-4X"
        mappings={[]}
        product={{
          product_name: "4 adet Kepeğe Karşı Etkili Şampuan 700 ml Ekonomik paket",
          desi: 3,
          packaging_profile_name: "Standart paket",
        }}
        notify={notify}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Seç" }));
    const quantity = screen.getByLabelText("Ürün Adedi");
    expect(quantity).toHaveValue(1);
    expect(screen.getByText("Birim desi: 0,7")).toBeVisible();
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "4");
    expect(screen.getByText("4 × ₺150,00 = ₺600,00")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Değişikliği önizle" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/cost-integrity/preview", {
        operationType: "ASSIGN_PRODUCT_COST",
        payload: {
          marketplace: "TRENDYOL",
          barcode: "SHAMPOO-4X",
          targetCostItemId: 42,
          quantity: 4,
        },
      }),
    );
    expect(await screen.findByText("İşlem önizlemesi")).toBeVisible();
    expect(screen.getByLabelText("Neden")).toHaveValue(
      "Yeni mapping / İlk maliyet eşlemesi",
    );
    expect(screen.getAllByText("Toplam ürün maliyeti")).toHaveLength(2);
    expect(screen.getAllByText("Değişiklik sonrası tahmini desi")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/cost-integrity/apply",
        expect.objectContaining({
          payload: expect.objectContaining({ quantity: 4 }),
          previewFingerprint: "quantity-4-fingerprint",
        }),
      ),
    );
  });

  test("unlinked LIVE offer yeni canonical maliyet previewu acar ve ilk mapping nedenini secer", async () => {
    const unlinked = {
      id: 81,
      product_name: "XYZ Şampuan 700 ml",
      current_price: 50,
      source_key: "BIM-XYZ",
      supplier_code: "BIM",
      offer_type: "LIVE",
      availability: "AVAILABLE",
      estimated_unit_desi: 1.8,
      last_seen_at: "2026-09-22T10:00:00Z",
      selection_state: "UNLINKED_ELIGIBLE",
    };
    get.mockResolvedValue({
      data: { items: [unlinked], total: 1, page: 1, limit: 20 },
    });
    post.mockImplementation(async (path, body) => {
      if (path.endsWith("/preview"))
        return {
          data: {
            operationType: body.operationType,
            payload: {
              ...body.payload,
              itemCode: "BIM_XYZ_SAMPUAN_ML_700ML",
              unitCost: 50,
            },
            previewFingerprint: "create-live-preview",
            warnings: [],
            impact: {
              createsCanonicalCostItem: true,
              supplierCode: "BIM",
              supplierProductName: "XYZ Şampuan 700 ml",
              canonicalItemName: body.payload.itemName,
              mappingCount: 1,
              activeProductCount: 1,
              byMarketplace: { TRENDYOL: 1, HEPSIBURADA: 0 },
              targetUnitCost: 50,
              targetQuantity: body.payload.quantity,
              targetLineCost: body.payload.quantity * 50,
              targetUnitDesi: body.payload.unitDesi,
              targetTotalDesi: body.payload.quantity * body.payload.unitDesi,
              targetEffectiveProductDesi: Math.ceil(
                body.payload.quantity * body.payload.unitDesi,
              ),
            },
          },
        };
      return {
        data: {
          id: 101,
          operation_type: "CREATE_COST_ITEM_FROM_OFFER_AND_ASSIGN",
        },
      };
    });
    render(
      <CostAssignmentEditor
        marketplace="TRENDYOL"
        barcode="XYZ-4X"
        mappings={[]}
        product={{ product_name: "4 adet XYZ Şampuan 700 ml" }}
        notify={vi.fn()}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Yeni maliyet kalemi oluştur ve seç",
      }),
    );
    expect(screen.getByLabelText("Maliyet kalemi adı")).toHaveValue(
      "XYZ Şampuan 700 ml",
    );
    expect(screen.getByLabelText("Yeni canonical birim desi")).toHaveValue(1.8);
    const quantity = screen.getByLabelText("Ürün Adedi");
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "4");
    expect(screen.getByText("4 × ₺50,00 = ₺200,00")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Değişikliği önizle" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/cost-integrity/preview", {
        operationType: "CREATE_COST_ITEM_FROM_OFFER_AND_ASSIGN",
        payload: {
          marketplace: "TRENDYOL",
          barcode: "XYZ-4X",
          supplierOfferId: 81,
          itemName: "XYZ Şampuan 700 ml",
          unitDesi: 1.8,
          quantity: 4,
        },
      }),
    );
    expect(await screen.findByText("Yeni maliyet kalemi oluşturulacak")).toBeVisible();
    expect(screen.getByLabelText("Neden")).toHaveValue(
      "Yeni mapping / İlk maliyet eşlemesi",
    );
    expect(
      screen.getByRole("button", { name: "Oluştur ve eşleştir" }),
    ).toBeVisible();
  });

  test("unlinked offer apply conflict selectoru yeniler ve stale secimi temizler", async () => {
    const notify = vi.fn();
    const onChanged = vi.fn();
    const unlinked = {
      ...offer,
      id: 81,
      product_name: "XYZ Şampuan 700 ml",
      current_price: 50,
      supplier_code: "BIM",
      canonical_cost_item_id: null,
      linked_cost_item_name: null,
      selection_state: "UNLINKED_ELIGIBLE",
    };
    get
      .mockResolvedValueOnce({
        data: { items: [unlinked], total: 1, page: 1, limit: 20 },
      })
      .mockResolvedValue({
        data: {
          items: [
            {
              ...unlinked,
              canonical_cost_item_id: 42,
              linked_cost_item_name: "XYZ Şampuan 700 ml",
              selection_state: "LINKED",
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        },
      });
    post.mockImplementation(async (path, body) => {
      if (path.endsWith("/preview"))
        return {
          data: {
            operationType: body.operationType,
            payload: { ...body.payload, itemCode: "BIM_XYZ", unitCost: 50 },
            previewFingerprint: "stale-create-preview",
            warnings: [],
            impact: {
              createsCanonicalCostItem: true,
              mappingCount: 1,
              activeProductCount: 1,
              byMarketplace: { TRENDYOL: 1, HEPSIBURADA: 0 },
              targetUnitCost: 50,
              targetQuantity: 1,
              targetLineCost: 50,
              targetUnitDesi: 0,
              targetTotalDesi: 0,
            },
          },
        };
      const conflict = new Error("linked");
      conflict.code = "SUPPLIER_OFFER_ALREADY_LINKED";
      throw conflict;
    });
    render(
      <CostAssignmentEditor
        marketplace="TRENDYOL"
        barcode="XYZ-NEW"
        mappings={[]}
        notify={notify}
        onChanged={onChanged}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Yeni maliyet kalemi oluştur ve seç",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Değişikliği önizle" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Oluştur ve eşleştir" }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith(
      "Bu tedarikçi ürünü siz önizlemeyi açtıktan sonra başka bir maliyet kalemine bağlandı. Sonuçları yenileyin.",
      "error",
    );
    expect(screen.queryByText("İşlem önizlemesi")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Maliyet kalemi adı")).not.toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Canonical: XYZ Şampuan 700 ml")).toBeVisible();
  });

  test("humanized maliyet aksiyonlari kapsam aciklamalariyla render olur", async () => {
    get.mockImplementation(async (path) =>
      path.includes("/context")
        ? {
            data: {
              costItem: { id: 1, item_name: "Mevcut maliyet", unit_cost: 50 },
              mappings: [
                { id: 3, marketplace: "TRENDYOL", barcode: "XYZ", quantity: 1 },
              ],
              supplierOffers: [],
              hardDeleteEligibility: { eligible: false },
            },
          }
        : { data: { items: [offer], total: 1, page: 1, limit: 20 } },
    );
    render(
      <CostAssignmentEditor
        marketplace="TRENDYOL"
        barcode="XYZ"
        mappings={[
          {
            id: 3,
            cost_item_id: 1,
            item_name: "Mevcut maliyet",
            unit_cost: 50,
            quantity: 1,
          },
        ]}
        notify={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("button", {
        name: "Bu ürünün maliyetini değiştir",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Tedarikçi kaynağını değiştir" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Yalnız bu marketplace ürününün bağlı olduğu maliyet kalemini değiştirir.",
      ),
    ).toBeVisible();
    await userEvent.click(screen.getByText("Diğer maliyet işlemleri"));
    for (const label of [
      "Eski tedarikçi kaydını yenisiyle eşleştir",
      "Tüm mappingleri başka maliyet kalemine taşı",
      "Mappingleri farklı maliyetlere ayır",
    ])
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Tüm mappingleri başka maliyet kalemine taşı",
      }),
    );
    expect(
      screen.getByText(
        "Bu maliyet kalemini kullanan tüm ürünleri tek bir yeni maliyet kalemine taşır.",
      ),
    ).toBeVisible();
  });

  test("humanized aksiyonlar mevcut backend operation tiplerini korur", async () => {
    const sameItemOffer = {
      ...offer,
      id: 8,
      product_name: "Aynı maliyetin yeni supplier kaydı",
      canonical_cost_item_id: 1,
    };
    const otherItemOffer = {
      ...offer,
      id: 9,
      product_name: "Başka canonical maliyet",
      canonical_cost_item_id: 2,
    };
    get.mockImplementation(async (path) =>
      path.includes("/context")
        ? {
            data: {
              costItem: { id: 1, item_name: "Mevcut maliyet", unit_cost: 50 },
              mappings: [
                {
                  id: 3,
                  marketplace: "TRENDYOL",
                  barcode: "XYZ",
                  quantity: 1,
                },
              ],
              supplierOffers: [
                {
                  supplier_offer_id: 7,
                  offer_type: "LIVE",
                  is_selected: true,
                },
              ],
              hardDeleteEligibility: { eligible: false },
            },
          }
        : {
            data: {
              items: [sameItemOffer, otherItemOffer],
              total: 2,
              page: 1,
              limit: 20,
            },
          },
    );
    post.mockImplementation(async (path, body) => ({
      data: {
        operationType: body.operationType,
        payload: body.payload,
        previewFingerprint: `${body.operationType}-preview`,
        impact: {
          mappingCount: 1,
          activeProductCount: 1,
          byMarketplace: { TRENDYOL: 1, HEPSIBURADA: 0 },
          currentUnitCost: 50,
          targetUnitCost: 50,
        },
      },
    }));
    render(
      <CostAssignmentEditor
        marketplace="TRENDYOL"
        barcode="XYZ"
        mappings={[
          {
            id: 3,
            cost_item_id: 1,
            item_name: "Mevcut maliyet",
            unit_cost: 50,
            quantity: 1,
          },
        ]}
        notify={vi.fn()}
      />,
    );
    const selectOffer = async (name) => {
      const card = (await screen.findByText(name)).closest("article");
      await userEvent.click(within(card).getByRole("button", { name: "Seç" }));
    };

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Tedarikçi kaynağını değiştir",
      }),
    );
    await selectOffer("Aynı maliyetin yeni supplier kaydı");
    expect(post).toHaveBeenLastCalledWith("/api/cost-integrity/preview", {
      operationType: "CHANGE_SELECTED_OFFER",
      payload: { costItemId: 1, targetSupplierOfferId: 8 },
    });
    await userEvent.click(screen.getByRole("button", { name: "İptal" }));

    await userEvent.click(screen.getByText("Diğer maliyet işlemleri"));
    await userEvent.click(
      screen.getByRole("button", {
        name: "Eski tedarikçi kaydını yenisiyle eşleştir",
      }),
    );
    await selectOffer("Aynı maliyetin yeni supplier kaydı");
    expect(post).toHaveBeenLastCalledWith("/api/cost-integrity/preview", {
      operationType: "REPLACE_SUPPLIER_OFFER",
      payload: {
        costItemId: 1,
        oldSupplierOfferId: 7,
        newSupplierOfferId: 8,
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "İptal" }));

    await userEvent.click(
      screen.getByRole("button", {
        name: "Tüm mappingleri başka maliyet kalemine taşı",
      }),
    );
    await selectOffer("Başka canonical maliyet");
    expect(post).toHaveBeenLastCalledWith("/api/cost-integrity/preview", {
      operationType: "REPLACE_COST_ITEM",
      payload: { sourceCostItemId: 1, targetCostItemId: 2 },
    });
  });

  test.each([
    ["", "Ürün adedi zorunludur."],
    ["0", "Ürün adedi en az 1 olmalıdır."],
    ["-1", "Ürün adedi en az 1 olmalıdır."],
    ["1.5", "Ürün adedi tam sayı olmalıdır."],
  ])("geçersiz quantity %s preview'dan önce reddedilir", async (value, message) => {
    const notify = vi.fn();
    render(
      <CostAssignmentEditor
        marketplace="TRENDYOL"
        barcode="INVALID-QTY"
        mappings={[]}
        notify={notify}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Seç" }));
    fireEvent.change(screen.getByLabelText("Ürün Adedi"), {
      target: { value },
    });
    await userEvent.click(screen.getByRole("button", { name: "Değişikliği önizle" }));
    expect(screen.getByText(message)).toBeVisible();
    expect(notify).toHaveBeenCalledWith(message, "error");
    expect(post).not.toHaveBeenCalled();
  });

  test("mevcut mapping quantity yuklenir ve ayni canonical item icinde duzeltilir", async () => {
    const notify = vi.fn();
    get.mockImplementation(async (path) =>
      path.includes("/context")
        ? {
            data: {
              costItem: {
                id: 1,
                item_name: "Şampuan 700 ml",
                unit_cost: 150,
                unit_desi: 0.7,
              },
              mappings: [
                {
                  id: 3,
                  marketplace: "TRENDYOL",
                  barcode: "SHAMPOO-4X",
                  quantity: 1,
                },
              ],
              supplierOffers: [],
              hardDeleteEligibility: { eligible: false },
            },
          }
        : { data: { items: [offer], total: 1, page: 1, limit: 20 } },
    );
    post.mockResolvedValue({
      data: {
        operationType: "REASSIGN_PRODUCT_COST",
        payload: {
          marketplace: "TRENDYOL",
          barcode: "SHAMPOO-4X",
          sourceCostItemId: 1,
          targetCostItemId: 1,
          quantity: 4,
        },
        previewFingerprint: "quantity-edit",
        impact: {
          mappingCount: 1,
          targetQuantity: 4,
          targetUnitCost: 150,
          targetLineCost: 600,
          byMarketplace: { TRENDYOL: 1, HEPSIBURADA: 0 },
        },
      },
    });
    render(
      <CostAssignmentEditor
        marketplace="TRENDYOL"
        barcode="SHAMPOO-4X"
        mappings={[
          {
            id: 3,
            cost_item_id: 1,
            item_name: "Şampuan 700 ml",
            unit_cost: 150,
            unit_desi: 0.7,
            quantity: 1,
          },
        ]}
        product={{ manual_desi_override: 5, desi: 5 }}
        notify={notify}
      />,
    );
    const quantity = await screen.findByLabelText("Ürün Adedi");
    expect(quantity).toHaveValue(1);
    expect(screen.getByText("5 · Manuel override")).toBeVisible();
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "4");
    await userEvent.click(screen.getByRole("button", { name: "Değişikliği önizle" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/cost-integrity/preview", {
        operationType: "REASSIGN_PRODUCT_COST",
        payload: {
          marketplace: "TRENDYOL",
          barcode: "SHAMPOO-4X",
          sourceCostItemId: 1,
          targetCostItemId: 1,
          quantity: 4,
        },
      }),
    );
  });

  test("canonical unit desi mevcut guvenli akista drawer icinden guncellenir", async () => {
    const notify = vi.fn();
    const onSaved = vi.fn();
    get.mockResolvedValue({
      data: {
        mappings: [
          { marketplace: "TRENDYOL", barcode: "TY-1" },
          { marketplace: "TRENDYOL", barcode: "TY-2" },
          { marketplace: "HEPSIBURADA", barcode: "HB-1" },
        ],
      },
    });
    post.mockResolvedValue({
      data: {
        id: 12,
        item_code: "SHAMPOO_700ML",
        unit_desi: 1.8,
      },
    });
    const view = render(
      <CanonicalDesiEditor
        costItemId={12}
        itemCode="SHAMPOO_700ML"
        unitDesi={1.5}
        quantity={4}
        product={{ manual_desi_override: 5 }}
        notify={notify}
        onSaved={onSaved}
      />,
    );
    const input = screen.getByLabelText("Canonical birim desi");
    expect(input).toHaveValue(1.5);
    expect(screen.getByText("ceil(1,5 × 4) = 6")).toBeVisible();
    expect(screen.getByText(/manuel desi override aktif: 5/i)).toBeVisible();

    view.rerender(
      <CanonicalDesiEditor
        costItemId={12}
        itemCode="SHAMPOO_700ML"
        unitDesi={1.5}
        quantity={5}
        product={{ manual_desi_override: 5 }}
        notify={notify}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByLabelText("Canonical birim desi")).toHaveValue(1.5);
    expect(screen.getByText("ceil(1,5 × 5) = 8")).toBeVisible();
    expect(post).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText("Canonical birim desi"));
    await userEvent.type(screen.getByLabelText("Canonical birim desi"), "1.8");
    expect(screen.getByText("ceil(1,8 × 5) = 9")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Desiyi güncelle" }));
    expect(await screen.findByText("Ortak birim desiyi güncelle")).toBeVisible();
    expect(screen.getByText(/Trendyol: 2 mapping/)).toBeVisible();
    expect(screen.getByText(/Hepsiburada: 1 mapping/)).toBeVisible();
    expect(screen.getByText(/manuel desi override değeri korunacaktır/i)).toBeVisible();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Desiyi güncelle" }).at(-1),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/cost-items/desi-review/SHAMPOO_700ML/resolve",
        { unit_desi: 1.8 },
      ),
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ unit_desi: 1.8 }),
    );
    expect(notify).toHaveBeenCalledWith("Ortak birim desi güncellendi");
  });

  test("kullanilmayan canonical item icin gereksiz shared-impact alarmi gostermez", async () => {
    get.mockResolvedValue({ data: { mappings: [] } });
    render(
      <CanonicalDesiEditor
        costItemId={44}
        itemCode="UNUSED_ITEM"
        unitDesi={0}
        quantity={4}
        notify={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText("Canonical birim desi"), "1.8");
    await userEvent.click(screen.getByRole("button", { name: "Desiyi güncelle" }));
    expect(await screen.findByText("Ortak birim desiyi güncelle")).toBeVisible();
    expect(screen.queryByText(/Trendyol:/)).not.toBeInTheDocument();
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
    await userEvent.click(
      await screen.findByText("Diğer maliyet işlemleri"),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Mappingleri farklı maliyetlere ayır",
      }),
    );
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
