import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Columns3, Download } from "lucide-react";
import { Badge, Empty, toneFor } from "./ui";

function savedHiddenColumns(key) {
  if (!key) return [];
  try {
    const value = JSON.parse(
      localStorage.getItem(`table-columns:${key}`) || "[]",
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function csvCell(value) {
  const normalized =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return `"${normalized.replaceAll('"', '""')}"`;
}

export function buildCsv(columns, rows) {
  const exportColumns = columns.filter(
    (column) =>
      column.exportable !== false && !["ops", "run"].includes(column.key),
  );
  return [
    exportColumns.map((column) => csvCell(column.label)).join(";"),
    ...rows.map((row) =>
      exportColumns
        .map((column) =>
          csvCell(
            column.exportValue ? column.exportValue(row) : row[column.key],
          ),
        )
        .join(";"),
    ),
  ].join("\n");
}

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
  columnVisibilityKey,
  exportFileName = columnVisibilityKey || "tablo",
  exportRows,
}) {
  const [localSort, setLocalSort] = useState({ key: null, direction: "asc" });
  const [hiddenColumns, setHiddenColumns] = useState(() =>
    savedHiddenColumns(columnVisibilityKey),
  );
  useEffect(() => {
    setHiddenColumns(savedHiddenColumns(columnVisibilityKey));
  }, [columnVisibilityKey]);
  const activeSort = sort || localSort;
  const visibleColumns = columns.filter(
    (column) => !hiddenColumns.includes(column.key),
  );
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
  function toggleColumn(key) {
    if (!hiddenColumns.includes(key) && visibleColumns.length === 1) return;
    const next = hiddenColumns.includes(key)
      ? hiddenColumns.filter((item) => item !== key)
      : [...hiddenColumns, key];
    setHiddenColumns(next);
    if (columnVisibilityKey)
      localStorage.setItem(
        `table-columns:${columnVisibilityKey}`,
        JSON.stringify(next),
      );
  }
  function exportCsv() {
    const csv = buildCsv(visibleColumns, exportRows || sortedRows);
    const url = URL.createObjectURL(
      new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(exportFileName)
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  if (!rows.length) return <Empty />;
  return (
    <div className="table-shell">
      <div className="table-toolbar">
        <button
          type="button"
          className="table-tool-btn"
          title="Görünen tabloyu CSV olarak indir"
          aria-label="CSV dışa aktar"
          onClick={exportCsv}
        >
          <Download size={17} />
        </button>
        {columnVisibilityKey && (
          <details className="column-menu">
            <summary title="Kolonları göster veya gizle" aria-label="Kolonlar">
              <Columns3 size={17} />
            </summary>
            <div>
              {columns
                .filter((column) => column.hideable !== false)
                .map((column) => (
                  <label key={column.key}>
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.includes(column.key)}
                      disabled={
                        !hiddenColumns.includes(column.key) &&
                        visibleColumns.length === 1
                      }
                      onChange={() => toggleColumn(column.key)}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
            </div>
          </details>
        )}
      </div>
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
              {visibleColumns.map((c) => (
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
                {visibleColumns.map((c) => {
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
