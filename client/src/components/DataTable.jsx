import React, { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { Badge, Empty, toneFor } from "./ui";
export default function DataTable({
  columns,
  rows = [],
  onRowClick,
  sort,
  onSort,
  selectedIds,
  onSelectionChange,
  rowKey,
  canSelectRow = () => true,
}) {
  const [localSort, setLocalSort] = useState({ key: null, direction: "asc" });
  const activeSort = sort || localSort;
  const getRowKey = (row, index) =>
    rowKey?.(row) ?? row.id ?? row.barcode ?? index;
  const sortedRows = useMemo(() => {
    if (!activeSort?.key || onSort) return rows;
    const direction = activeSort.direction === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const left = a[activeSort.key];
      const right = b[activeSort.key];
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber))
        return (leftNumber - rightNumber) * direction;
      return String(left).localeCompare(String(right), "tr") * direction;
    });
  }, [activeSort, onSort, rows]);
  const selected = new Set(selectedIds || []);
  const selectable = Boolean(onSelectionChange);
  const selectionRows = sortedRows.filter(canSelectRow);
  const allSelected =
    selectable &&
    selectionRows.length > 0 &&
    selectionRows.every((row) => selected.has(getRowKey(row)));
  function changeSort(key) {
    if (onSort) return onSort(key);
    setLocalSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }
  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange([...next]);
  }
  if (!rows.length) return <Empty />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {selectable && (
              <th className="select-column">
                <input
                  type="checkbox"
                  aria-label="Tüm satırları seç"
                  checked={allSelected}
                  onChange={() =>
                    onSelectionChange(
                      allSelected
                        ? []
                        : selectionRows.map((row) => getRowKey(row)),
                    )
                  }
                />
              </th>
            )}
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width }}>
                {c.sortable !== false && !["ops", "run"].includes(c.key) ? (
                  <button
                    className="sort-btn"
                    onClick={() => changeSort(c.key)}
                  >
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
          {sortedRows.map((row, index) => (
            <tr
              key={getRowKey(row, index)}
              onClick={() => onRowClick?.(row)}
              className={onRowClick ? "clickable" : ""}
            >
              {selectable && (
                <td
                  className="select-column"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    aria-label="Satırı seç"
                    checked={selected.has(getRowKey(row, index))}
                    disabled={!canSelectRow(row)}
                    onChange={() => toggle(getRowKey(row, index))}
                  />
                </td>
              )}
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
