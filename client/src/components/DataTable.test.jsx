import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import DataTable, { buildCsv } from "./DataTable";

const columns = [
  { key: "barcode", label: "Barkod", hideable: false },
  { key: "name", label: "Ürün" },
  { key: "price", label: "Fiyat" },
];
const rows = [{ barcode: "8690609598109", name: "Menekşe", price: 312.28 }];

describe("DataTable kolon görünürlüğü", () => {
  test("seçimi saklar ve farklı tablo anahtarına taşımadan yeniler", async () => {
    const user = userEvent.setup();
    const view = render(
      <DataTable
        columns={columns}
        rows={rows}
        columnVisibilityKey="products"
      />,
    );
    await user.click(screen.getByLabelText("Kolonlar"));
    await user.click(screen.getByLabelText("Ürün"));
    expect(screen.queryByRole("columnheader", { name: /Ürün/ })).toBeNull();
    expect(localStorage.getItem("table-columns:products")).toContain("name");

    view.rerender(
      <DataTable columns={columns} rows={rows} columnVisibilityKey="buybox" />,
    );
    expect(screen.getByRole("columnheader", { name: /Ürün/ })).toBeVisible();
  });

  test("CSV verisini görünen kolonlarla ve Excel uyumlu kaçışla üretir", () => {
    const csv = buildCsv(columns, [
      { barcode: "1", name: 'Menekşe "Konsantre"', price: 312.28 },
    ]);
    expect(csv).toContain('"Barkod";"Ürün";"Fiyat"');
    expect(csv).toContain('"Menekşe ""Konsantre"""');
    expect(csv).toContain('"312.28"');
  });
});
