import React from "react";
import { ArrowUpDown } from "lucide-react";
import { Badge, Empty, toneFor } from "./ui";
export default function DataTable({
  columns,
  rows = [],
  onRowClick,
  sort,
  onSort,
}) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width }}>
                {c.sortable ? (
                  <button className="sort-btn" onClick={() => onSort?.(c.key)}>
                    {c.label}
                    <ArrowUpDown size={14} />
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id || row.barcode || index}
              onClick={() => onRowClick?.(row)}
              className={onRowClick ? "clickable" : ""}
            >
              {columns.map((c) => {
                const value = c.render ? c.render(row) : row[c.key];
                return (
                  <td
                    key={c.key}
                    title={typeof value === "string" ? value : undefined}
                  >
                    {c.badge ? (
                      <Badge tone={toneFor(value)}>{value ?? "-"}</Badge>
                    ) : (
                      (value ?? "-")
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export const money = (value) =>
  Number(value || 0).toLocaleString("tr-TR", {
    style: "currency",
    currency: "TRY",
  });
export const percent = (value) =>
  `%${Number(value || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
export const date = (value) =>
  value ? new Date(value).toLocaleString("tr-TR") : "-";
