import React from "react";
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { AtomicCostRecipeEditor } from "./CostManagement";
import { get, post } from "../lib/api";
vi.mock("../lib/api", () => ({ get: vi.fn(), post: vi.fn() }));
const penne = {
  id: 31,
  cost_item_id: 1,
  item_name: "Penne",
  cost_item_code: "PENNE",
  quantity: 3,
  unit_cost: 75,
  unit_desi: 0.3,
  line_cost: 225,
};
const fusilli = {
  id: 92,
  canonical_cost_item_id: 2,
  canonical_item_code: "FUSILLI",
  product_name: "Fusilli",
  linked_cost_item_name: "Fusilli",
  current_price: 69,
  linked_unit_cost: 69,
  linked_unit_desi: 0.4,
  supplier_code: "FILE_MARKET",
  offer_type: "LIVE",
  availability: "AVAILABLE",
  selection_state: "LINKED",
};
let offers;
beforeEach(() => {
  vi.clearAllMocks();
  offers = [fusilli];
  get.mockImplementation(async (path) => ({
    data: path.includes("/context")
      ? {
          costItem: {
            id: 1,
            item_name: "Penne",
            item_code: "PENNE",
            unit_cost: 75,
            unit_desi: 0.3,
          },
          mappings: [],
          supplierOffers: [],
          hardDeleteEligibility: { eligible: false },
        }
      : { items: offers, total: offers.length, page: 1, limit: 20 },
  }));
  post.mockImplementation(async (path, body) => ({
    data: path.endsWith("/apply")
      ? { id: 101, operation_type: "REPLACE_PRODUCT_COST_RECIPE" }
      : {
          ...body,
          previewFingerprint: "full-recipe",
          warnings: [],
          impact: {
            mappingCount: 1,
            marketplace: "TRENDYOL",
            barcode: "ATOMIC",
            currentRecipe: [
              { itemName: "Penne", quantity: 3, unitCost: 75, lineCost: 225 },
            ],
            proposedRecipe: body.payload.components.map((row) => ({
              itemName: row.costItemId === 1 ? "Penne" : "Fusilli",
              quantity: row.quantity,
              unitCost: row.costItemId === 1 ? 75 : 69,
              lineCost: row.quantity * (row.costItemId === 1 ? 75 : 69),
            })),
            currentTotals: { cost: 225, effectiveDesi: 1 },
            proposedTotals: { cost: 219, effectiveDesi: 1 },
          },
        },
  }));
});
function editor(mappings = [penne], props = {}) {
  return render(
    <AtomicCostRecipeEditor
      marketplace="TRENDYOL"
      barcode="ATOMIC"
      mappings={mappings}
      product={{ barcode: "ATOMIC" }}
      notify={vi.fn()}
      {...props}
    />,
  );
}
async function addSelected() {
  await userEvent.click(
    screen.getAllByRole("button", { name: "+ Bir fiziki ürün daha bağla" })[0],
  );
  await userEvent.click(await screen.findByRole("button", { name: "Seç" }));
  await userEvent.click(screen.getByRole("button", { name: "Taslağa ekle" }));
}
test("quantity plus addition stay local; full before/after preview and one final apply", async () => {
  editor();
  fireEvent.change(screen.getByLabelText("Penne adedi"), {
    target: { value: "2" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Adedi güncelle" }));
  await addSelected();
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Fusilli adedi")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Recipe değişikliklerini önizle" }),
  );
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith("/api/cost-integrity/preview", {
    operationType: "REPLACE_PRODUCT_COST_RECIPE",
    payload: {
      marketplace: "TRENDYOL",
      barcode: "ATOMIC",
      components: [
        { costItemId: 1, quantity: 2 },
        { costItemId: 2, quantity: 1 },
      ],
    },
  });
  expect(
    screen.getByRole("region", { name: "Mevcut recipe" }),
  ).toHaveTextContent("₺225,00");
  expect(
    screen.getByRole("region", { name: "Önerilen recipe" }),
  ).toHaveTextContent("₺219,00");
  await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
  expect(
    post.mock.calls.filter(([path]) => path.endsWith("/apply")),
  ).toHaveLength(1);
  expect(
    post.mock.calls.find(([path]) => path.endsWith("/apply"))[1].operationType,
  ).toBe("REPLACE_PRODUCT_COST_RECIPE");
});
test("cancel discards staged additions, removals and quantity changes without a write", async () => {
  editor();
  await addSelected();
  const card = screen.getByLabelText("Penne adedi").closest("article");
  await userEvent.click(
    within(card).getByRole("button", { name: "Bileşeni kaldır" }),
  );
  expect(screen.queryByLabelText("Penne adedi")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Taslağı iptal et" }),
  );
  expect(screen.getByLabelText("Penne adedi")).toHaveValue(3);
  expect(screen.queryByLabelText("Fusilli adedi")).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
test("initial unmapped recipe stages two components before any preview or apply", async () => {
  editor([]);
  await userEvent.click(await screen.findByRole("button", { name: "Seç" }));
  await userEvent.click(screen.getByRole("button", { name: "Taslağa ekle" }));
  offers = [
    {
      ...fusilli,
      id: 93,
      canonical_cost_item_id: 3,
      product_name: "Macaroni",
      linked_cost_item_name: "Macaroni",
    },
  ];
  // Changing supplier remounts the bounded existing server selector request.
  await userEvent.selectOptions(screen.getByLabelText("Tedarikçi"), "BIM");
  await waitFor(() => expect(screen.getByText("Macaroni")).toBeVisible());
  await addSelected();
  expect(screen.getByLabelText("Fusilli adedi")).toBeVisible();
  expect(screen.getByLabelText("Macaroni adedi")).toBeVisible();
  expect(post).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Recipe değişikliklerini önizle" }),
  );
  expect(post.mock.calls[0][1].payload.components).toEqual([
    { costItemId: 2, quantity: 1 },
    { costItemId: 3, quantity: 1 },
  ]);
});
test("unlinked LIVE canonical is only a staged descriptor until final recipe apply", async () => {
  offers = [
    {
      ...fusilli,
      canonical_cost_item_id: null,
      linked_cost_item_name: null,
      selection_state: "UNLINKED_ELIGIBLE",
    },
  ];
  editor([]);
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Yeni maliyet kalemi oluştur ve seç",
    }),
  );
  expect(post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Yeni canonical birim desi"), {
    target: { value: "0.4" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Taslağa ekle" }));
  expect(post).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Recipe değişikliklerini önizle" }),
  );
  expect(post.mock.calls[0][1].payload.components).toEqual([
    { supplierOfferId: 92, itemName: "Fusilli", unitDesi: 0.4, quantity: 1 },
  ]);
});

test("replace one component keeps the other; duplicate canonical and final removal are blocked", async () => {
  const second = {
    ...penne,
    id: 32,
    cost_item_id: 3,
    item_name: "Macaroni",
    cost_item_code: "MACARONI",
    quantity: 1,
    unit_cost: 80,
  };
  editor([penne, second]);
  await userEvent.click(
    within(
      screen.getByLabelText("Macaroni adedi").closest("article"),
    ).getByRole("button", { name: "Bu bileşeni değiştir" }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Seç" }));
  await userEvent.click(screen.getByRole("button", { name: "Taslağa ekle" }));
  expect(screen.getByLabelText("Penne adedi")).toHaveValue(3);
  expect(screen.queryByLabelText("Macaroni adedi")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Fusilli adedi")).toHaveValue(1);
  await addSelected();
  expect(screen.getAllByLabelText("Fusilli adedi")).toHaveLength(1);
  await userEvent.click(
    within(screen.getByLabelText("Penne adedi").closest("article")).getByRole(
      "button",
      { name: "Bileşeni kaldır" },
    ),
  );
  expect(
    screen.getByRole("button", { name: "Bileşeni kaldır" }),
  ).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});

test("quantity inputs belong directly to draft; invalid values block preview and cancel restores quantity", async () => {
  editor();
  fireEvent.change(screen.getByLabelText("Penne adedi"), {
    target: { value: "1.5" },
  });
  expect(
    screen.getByRole("button", { name: "Recipe değişikliklerini önizle" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Penne adedi"), {
    target: { value: "2" },
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Recipe değişikliklerini önizle" }),
  );
  expect(post.mock.calls[0][1].payload.components).toEqual([
    { costItemId: 1, quantity: 2 },
  ]);
  await userEvent.click(screen.getByRole("button", { name: "İptal" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Taslağı iptal et" }),
  );
  expect(screen.getByLabelText("Penne adedi")).toHaveValue(3);
  expect(
    post.mock.calls.filter(([path]) => path.endsWith("/apply")),
  ).toHaveLength(0);
});

test("Manual/Diğer form stages canonical descriptor without creating a record", async () => {
  editor([]);
  await userEvent.selectOptions(screen.getByLabelText("Tedarikçi"), "OTHER");
  await userEvent.click(
    screen.getByRole("button", { name: "Manuel maliyet oluştur" }),
  );
  fireEvent.change(screen.getByLabelText("Ürün adı"), {
    target: { value: "Manual physical" },
  });
  fireEvent.change(screen.getByLabelText("Fiyat"), { target: { value: "25" } });
  await userEvent.click(screen.getByRole("button", { name: "Önizle" }));
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Manual physical adedi")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Recipe değişikliklerini önizle" }),
  );
  expect(post.mock.calls[0][1].payload.components).toEqual([
    expect.objectContaining({
      itemName: "Manual physical",
      unitCost: 25,
      quantity: 1,
      physicalSupplierCode: "OTHER",
    }),
  ]);
});
