import React from "react";
import { render, screen } from "@testing-library/react";
import { test, expect, vi } from "vitest";
import { CostBreakdown } from "./Products";
vi.mock("../components/AtomicCostRecipeEditor", () => ({
  default: () => null,
}));
const product = {
  barcode: "fixture",
  my_price: 499,
  commission_rate: 17,
  min_price: 593.46,
  calculated_product_cost: 310,
  calculated_shipping_cost: 94.2,
  packaging_cost: 5,
  service_fee: 13.19,
  target_profit: 50,
};
const cash = {
  version: "HB_CASH_RUNTIME_V1",
  mode: "ENFORCE",
  applied: true,
  minimum: 593.46,
  contribution: -25.19,
  targetShipping: 94.2,
  checkedAt: "2026-11-18T00:00:00Z",
  commissionModel: { vatRate: 20 },
  commission: { commissionBase: 499, net: 84.83, vat: 16.97, gross: 101.8 },
  otherVerifiedCosts: 0,
};
function show(e = cash, p = product) {
  return render(
    <CostBreakdown
      marketplace="HEPSIBURADA"
      data={{ product: { ...p, hb_cash_economics: e }, mappings: [] }}
      notify={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
}
test("cash breakdown shows gross once, original SKU rate and included VAT separately", () => {
  show();
  expect(screen.getByText("Brüt komisyon (%17 + KDV)")).toBeVisible();
  expect(screen.getByText("₺101,80")).toBeVisible();
  expect(screen.getByText("₺16,97")).toBeVisible();
  expect(screen.getByText(/Nakit katkı tabanı/)).toBeVisible();
});
test("shadow comparison cannot label its gross rate as active pricing", () => {
  show({ ...cash, mode: "SHADOW", applied: false });
  expect(
    screen.getByText(/SHADOW: fiyatlandırma yetkisi vermez/),
  ).toBeVisible();
  expect(screen.getByText("Komisyon (%17)")).toBeVisible();
  expect(screen.getByText("₺84,83")).toBeVisible();
});
test("price changed after cached proof shows unknown rather than stale gross charge", () => {
  show(cash, { ...product, my_price: 510 });
  expect(screen.getByText("UNKNOWN")).toBeVisible();
  expect(screen.getByText(/komisyon kanıtı yenilenmeli/)).toBeVisible();
});

test("unknown cash economics never presents a zero safe floor", () => {
  show(
    {
      version: "HB_CASH_RUNTIME_V1",
      mode: "ENFORCE",
      applied: false,
      blockers: ["HB_CASH_EXPENSE_UNVERIFIED"],
    },
    {
      ...product,
      min_price: null,
      calculated_net_profit: null,
      data_status: "HB_CASH_EVIDENCE_UNVERIFIED",
    },
  );
  expect(screen.getByText(/güvenli fiyat doğrulanmadı/)).toBeVisible();
  expect(screen.getByText("UNKNOWN")).toBeVisible();
  expect(screen.queryByText(/= ₺0,00/)).not.toBeInTheDocument();
});
