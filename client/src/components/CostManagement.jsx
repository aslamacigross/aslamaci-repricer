import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  ExternalLink,
  Pencil,
  RotateCcw,
  Scissors,
  Trash2,
} from "lucide-react";
import { get, post } from "../lib/api";
import { date, money } from "./DataTable";
import {
  Badge,
  Button,
  Empty,
  Field,
  Loading,
  Modal,
  Pagination,
  SearchInput,
} from "./ui";

export const SUPPLIERS = [
  { code: "FILE_MARKET", label: "File" },
  { code: "BIZIM_MARKET", label: "Bizim" },
  { code: "BIM", label: "BİM" },
  { code: "ROSSMANN", label: "Rossmann" },
  { code: "OTHER", label: "Diğer" },
];

const REASONS = [
  "Yanlış maliyet eşleşmesi",
  "Manuel kaydı canlı ürüne geçiriyorum",
  "Supplier ürünü yenilendi/değişti",
  "Duplicate/eski kayıt kaldırılıyor",
  "Ürün varyantlarını ayırıyorum",
  "Diğer",
];

function operationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `cost-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorMessage(error) {
  const messages = {
    STALE_PREVIEW:
      "Bu kayıt siz önizlemeyi açtıktan sonra değişti. Güncel bilgileri yeniden yükleyin.",
    INCOMPLETE_SPLIT: "Bütün ürünleri bir hedef maliyet kalemine atamalısınız.",
    COST_ITEM_IN_USE:
      "Bu maliyet daha önce kullanıldığı için kalıcı silinemez. Kaldır/Arşivle seçeneğini kullanın.",
    SOURCE_MAPPING_REQUIRED: "Değiştirilecek mevcut maliyet satırını seçin.",
  };
  return messages[error?.code] || error?.message || "İşlem tamamlanamadı";
}

function sourceUrl(item) {
  return item.source_url || item.raw_data?.url || item.raw_data?.source_url;
}

export function CostSelector({
  onSelect,
  selectedId,
  allowManual = true,
  requireCanonical = true,
  onManualSubmit,
  initialSupplier = "FILE_MARKET",
}) {
  const [supplier, setSupplier] = useState(initialSupplier);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    setPage(1);
    setResult(null);
    setSearch("");
    setManualOpen(false);
    requestSequence.current += 1;
  }, [supplier]);

  useEffect(() => {
    const requestId = ++requestSequence.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "20",
        });
        if (search.trim()) params.set("search", search.trim());
        const response = await get(
          `/api/supplier-price-pools/${supplier}/items?${params}`,
        );
        if (requestSequence.current === requestId) setResult(response.data);
      } catch (nextError) {
        if (requestSequence.current === requestId)
          setError(errorMessage(nextError));
      } finally {
        if (requestSequence.current === requestId) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [supplier, search, page]);

  return (
    <div className="cost-selector" data-testid="shared-cost-selector">
      <div className="cost-selector-controls">
        <Field label="Tedarikçi">
          <select
            aria-label="Tedarikçi"
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
          >
            {SUPPLIERS.map((item) => (
              <option value={item.code} key={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ürün">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Ürün, barkod veya supplier kodu ara"
          />
        </Field>
      </div>
      {supplier === "OTHER" && allowManual && onManualSubmit && (
        <Button
          variant="secondary"
          icon={Pencil}
          onClick={() => setManualOpen((value) => !value)}
        >
          Manuel maliyet oluştur
        </Button>
      )}
      {manualOpen && (
        <ManualCostForm
          onCancel={() => setManualOpen(false)}
          onSubmit={onManualSubmit}
        />
      )}
      {loading && !result ? (
        <Loading label="Tedarikçi ürünleri aranıyor" />
      ) : error ? (
        <p className="cost-selector-error">{error}</p>
      ) : !(result?.items || []).length ? (
        <Empty label="Bu aramayla eşleşen ürün yok" />
      ) : (
        <div className="cost-offer-results">
          {result.items.map((item) => {
            const blocked = requireCanonical && !item.canonical_cost_item_id;
            const url = sourceUrl(item);
            return (
              <article
                className={
                  Number(selectedId) === Number(item.id) ? "selected" : ""
                }
                key={item.id}
              >
                <div>
                  <strong>{item.product_name}</strong>
                  <small>
                    {item.brand || item.source_key} · {money(item.current_price)}
                  </small>
                  <div className="cost-offer-badges">
                    <Badge tone={item.offer_type === "MANUAL" ? "warning" : "info"}>
                      {item.offer_type || "LIVE"}
                    </Badge>
                    <Badge tone={item.availability === "AVAILABLE" ? "success" : "danger"}>
                      {item.availability === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE"}
                    </Badge>
                    <Badge tone={item.stale ? "warning" : "success"}>
                      {item.stale ? "KONTROL GEREKİYOR" : "GÜNCEL"}
                    </Badge>
                    {item.is_selected && <Badge tone="success">SELECTED</Badge>}
                  </div>
                  <small>
                    Son görüldü: {date(item.checked_at || item.last_seen_at)}
                  </small>
                  {blocked && (
                    <small className="cost-selector-warning">
                      Bu supplier kaydı henüz canonical maliyet kalemine bağlı değil.
                    </small>
                  )}
                </div>
                <div className="cost-offer-actions">
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} /> Kaynağı aç
                    </a>
                  )}
                  <Button
                    variant={item.is_selected ? "secondary" : "primary"}
                    disabled={blocked}
                    onClick={() => onSelect(item)}
                  >
                    Seç
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {result && (
        <Pagination
          page={result.page || page}
          total={result.total || 0}
          limit={result.limit || 20}
          onChange={setPage}
        />
      )}
    </div>
  );
}

function ManualCostForm({ initial, onCancel, onSubmit, showDesi = true }) {
  const [form, setForm] = useState({
    itemName: initial?.itemName || "",
    unitCost: initial?.unitCost || "",
    unitDesi: initial?.unitDesi || 0,
    physicalSupplierCode: initial?.physicalSupplierCode || "OTHER",
    checkedAt: initial?.checkedAt
      ? String(initial.checkedAt).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  });
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="manual-cost-form">
      <Field label="Fiziki tedarikçi">
        <select
          value={form.physicalSupplierCode}
          onChange={(event) => set("physicalSupplierCode", event.target.value)}
        >
          {SUPPLIERS.map((supplier) => (
            <option value={supplier.code} key={supplier.code}>
              {supplier.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ürün adı">
        <input value={form.itemName} onChange={(e) => set("itemName", e.target.value)} />
      </Field>
      <Field label="Fiyat">
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={form.unitCost}
          onChange={(e) => set("unitCost", e.target.value)}
        />
      </Field>
      {showDesi && (
        <Field label="Birim desi">
          <input
            type="number"
            min="0"
            step="0.0001"
            value={form.unitDesi}
            onChange={(e) => set("unitDesi", e.target.value)}
          />
        </Field>
      )}
      <Field label="Son kontrol tarihi">
        <input
          type="date"
          value={form.checkedAt}
          onChange={(e) => set("checkedAt", e.target.value)}
        />
      </Field>
      <div className="drawer-actions">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>Vazgeç</Button>
        )}
        <Button
          icon={Check}
          disabled={!form.itemName || !(Number(form.unitCost) > 0) || !form.checkedAt}
          onClick={() => onSubmit({ ...form, unitCost: Number(form.unitCost), unitDesi: Number(form.unitDesi) })}
        >
          Önizle
        </Button>
      </div>
    </div>
  );
}

export function ImpactPreviewModal({ preview, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState(REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  if (!preview) return null;
  const impact = preview.impact || {};
  const finalReason = reason === "Diğer" ? customReason.trim() : reason;
  return (
    <Modal open onClose={onClose} title="İşlem önizlemesi">
      <div className="cost-impact-preview">
        <Badge tone="info">{preview.operationType}</Badge>
        <div className="metric-row">
          <div><span>Trendyol</span><b>{impact.byMarketplace?.TRENDYOL || 0}</b></div>
          <div><span>Hepsiburada</span><b>{impact.byMarketplace?.HEPSIBURADA || 0}</b></div>
          <div><span>Mapping</span><b>{impact.mappingCount || 0}</b></div>
          <div><span>Aktif ürün</span><b>{impact.activeProductCount || 0}</b></div>
        </div>
        <div className="cost-change-summary">
          <span>Mevcut maliyet</span><b>{money(impact.currentUnitCost)}</b>
          <span>Yeni maliyet</span><b>{money(impact.targetUnitCost)}</b>
        </div>
        {(impact.mappings || []).map((mapping) => (
          <div className="mapping-row" key={mapping.id || `${mapping.marketplace}:${mapping.barcode}`}>
            <div>
              <strong>{mapping.productName || mapping.barcode}</strong>
              <small>{mapping.marketplace} · {mapping.barcode} · {mapping.quantity} adet</small>
            </div>
          </div>
        ))}
        {(preview.warnings || []).map((warning) => (
          <p className="cost-selector-warning" key={warning}>{warning}</p>
        ))}
        <Field label="Neden">
          <select value={reason} onChange={(event) => setReason(event.target.value)}>
            {REASONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        {reason === "Diğer" && (
          <Field label="Açıklama">
            <textarea rows={3} value={customReason} onChange={(event) => setCustomReason(event.target.value)} />
          </Field>
        )}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>İptal</Button>
          <Button disabled={busy || !finalReason} onClick={() => onConfirm(finalReason)}>
            {busy ? "Uygulanıyor" : "Onayla"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function useOperation({ notify, onChanged }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastOperation, setLastOperation] = useState(null);

  async function open(operationType, payload) {
    setBusy(true);
    try {
      const response = await post("/api/cost-integrity/preview", {
        operationType,
        payload,
      });
      setPreview({ ...response.data, idempotencyKey: operationId() });
    } catch (error) {
      notify?.(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function apply(reason) {
    setBusy(true);
    try {
      const response = await post("/api/cost-integrity/apply", {
        operationType: preview.operationType,
        payload: preview.payload,
        previewFingerprint: preview.previewFingerprint,
        confirmedMappingCount: preview.impact?.mappingCount || 0,
        idempotencyKey: preview.idempotencyKey,
        reason,
      });
      setLastOperation({
        ...response.data,
        reversalIdempotencyKey: operationId(),
      });
      setPreview(null);
      notify?.("İşlem başarıyla tamamlandı");
      await onChanged?.();
    } catch (error) {
      notify?.(errorMessage(error), "error");
      if (error?.code === "STALE_PREVIEW") setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!lastOperation?.id) return;
    setBusy(true);
    try {
      await post(`/api/cost-integrity/operations/${lastOperation.id}/reverse`, {
        reason: "Son panel işlemi geri alındı",
        idempotencyKey: lastOperation.reversalIdempotencyKey,
      });
      setLastOperation(null);
      notify?.("İşlem geri alındı");
      await onChanged?.();
    } catch (error) {
      notify?.(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }
  return { preview, busy, lastOperation, open, apply, undo, close: () => setPreview(null) };
}

export function CostAssignmentEditor({
  marketplace,
  barcode,
  mappings = [],
  onChanged,
  notify,
}) {
  const [mappingId, setMappingId] = useState(mappings[0]?.id || "");
  const [context, setContext] = useState(null);
  const [mode, setMode] = useState("REASSIGN");
  const [splitAssignments, setSplitAssignments] = useState({});
  const [splitActiveMappingId, setSplitActiveMappingId] = useState(null);
  const operation = useOperation({ notify, onChanged });
  const mapping = mappings.find((row) => Number(row.id) === Number(mappingId));

  useEffect(() => {
    if (!mappings.some((row) => Number(row.id) === Number(mappingId)))
      setMappingId(mappings[0]?.id || "");
  }, [mappings, mappingId]);

  useEffect(() => {
    let active = true;
    setContext(null);
    if (!mapping?.cost_item_id) return undefined;
    get(`/api/cost-integrity/cost-items/${mapping.cost_item_id}/context`)
      .then((response) => active && setContext(response.data))
      .catch((error) => notify?.(errorMessage(error), "error"));
    return () => { active = false; };
  }, [mapping?.cost_item_id]);

  const selectedOffer = context?.supplierOffers?.find((offer) => offer.is_selected);
  const current = context?.costItem;
  const openTarget = (offer) => {
    if (mode === "SOURCE") {
      if (
        offer.canonical_cost_item_id &&
        Number(offer.canonical_cost_item_id) !== Number(current.id)
      ) {
        notify?.(
          "Bu ürün başka bir maliyet kalemine bağlı. Maliyeti değiştir akışını kullanın.",
          "error",
        );
        return;
      }
      if (
        selectedOffer?.offer_type !== "MANUAL" &&
        Number(offer.canonical_cost_item_id) !== Number(current.id)
      ) {
        notify?.(
          "Kaynak değişimi için bu maliyet kalemine bağlı bir teklif seçin.",
          "error",
        );
        return;
      }
      return operation.open(
        selectedOffer?.offer_type === "MANUAL" ? "MANUAL_TO_LIVE" : "CHANGE_SELECTED_OFFER",
        { costItemId: current.id, targetSupplierOfferId: offer.id },
      );
    }
    if (mode === "REPLACEMENT") {
      if (
        offer.canonical_cost_item_id &&
        Number(offer.canonical_cost_item_id) !== Number(current.id)
      ) {
        notify?.(
          "Bu ürün başka bir maliyet kalemine bağlı. Başka kalemle değiştir akışını kullanın.",
          "error",
        );
        return;
      }
      return operation.open("REPLACE_SUPPLIER_OFFER", {
        costItemId: current.id,
        oldSupplierOfferId: selectedOffer?.supplier_offer_id,
        newSupplierOfferId: offer.id,
      });
    }
    if (mode === "REPLACE")
      return operation.open("REPLACE_COST_ITEM", {
        sourceCostItemId: current.id,
        targetCostItemId: offer.canonical_cost_item_id,
      });
    if (mode === "SPLIT") {
      if (!context?.mappings?.length) return;
      const activeMapping =
        context.mappings.find(
          (row) => Number(row.id) === Number(splitActiveMappingId),
        ) ||
        context.mappings.find((row) => !splitAssignments[row.id]) ||
        context.mappings[0];
      setSplitAssignments((value) => ({
        ...value,
        [activeMapping.id]: Number(offer.canonical_cost_item_id),
      }));
      setSplitActiveMappingId(null);
      return;
    }
    return operation.open("REASSIGN_PRODUCT_COST", {
      marketplace,
      barcode,
      sourceCostItemId: mapping.cost_item_id,
      targetCostItemId: offer.canonical_cost_item_id,
      quantity: Number(mapping.quantity),
    });
  };

  const manualPreview = (form) =>
    operation.open("CREATE_MANUAL_COST", {
      marketplace,
      barcode,
      sourceCostItemId: mapping?.cost_item_id || null,
      itemCode: `MANUAL_${barcode}_${Date.now()}`.replace(/[^A-Z0-9_]/gi, "_").toUpperCase(),
      itemName: form.itemName,
      unitCost: form.unitCost,
      unitDesi: form.unitDesi,
      quantity: Number(mapping?.quantity || 1),
      physicalSupplierCode: form.physicalSupplierCode,
      checkedAt: form.checkedAt,
    });

  const editManual = (form) =>
    operation.open("EDIT_MANUAL_COST", {
      costItemId: current.id,
      supplierOfferId: selectedOffer.supplier_offer_id,
      ...form,
    });

  const previewSplit = () => {
    const assignments = (context?.mappings || []).map((row) => ({
      mappingId: Number(row.id),
      targetCostItemId: Number(splitAssignments[row.id]),
    }));
    if (assignments.some((row) => !row.targetCostItemId)) {
      notify?.("Bütün ürünleri bir hedef maliyet kalemine atamalısınız.", "error");
      return;
    }
    operation.open("SPLIT_COST_MAPPINGS", {
      sourceCostItemId: current.id,
      assignments,
    });
  };

  if (!mapping)
    return (
      <section className="cost-management-panel">
        <Empty label="Bu ürünün maliyet mappingi yok" />
        <CostSelector
          onSelect={(selected) =>
            operation.open("ASSIGN_PRODUCT_COST", {
              marketplace,
              barcode,
              targetCostItemId: selected.canonical_cost_item_id,
              quantity: 1,
            })
          }
          onManualSubmit={manualPreview}
        />
        {operation.lastOperation && (
          <div className="cost-operation-success">
            <span>İşlem başarıyla tamamlandı.</span>
            <Button
              variant="secondary"
              icon={RotateCcw}
              disabled={operation.busy}
              onClick={operation.undo}
            >
              Geri al
            </Button>
          </div>
        )}
        <ImpactPreviewModal
          preview={operation.preview}
          busy={operation.busy}
          onClose={operation.close}
          onConfirm={operation.apply}
        />
      </section>
    );
  return (
    <section className="cost-management-panel">
      <div className="cost-current-summary">
        <div>
          <span>Mevcut maliyet</span>
          <strong>{current?.item_name || mapping.item_name || mapping.cost_item_code}</strong>
          <small>
            {selectedOffer
              ? `${selectedOffer.offer_type || "LIVE"} · ${selectedOffer.physical_supplier_code || selectedOffer.supplier_code}`
              : "Seçili supplier kaynağı yok"}
          </small>
        </div>
        <b>{money(current?.unit_cost || mapping.unit_cost)}</b>
      </div>
      {mappings.length > 1 && (
        <Field label="Düzenlenecek mapping">
          <select value={mappingId} onChange={(event) => setMappingId(event.target.value)}>
            {mappings.map((row) => (
              <option value={row.id} key={row.id}>
                {row.item_name || row.cost_item_code} · {row.quantity} adet
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="cost-operation-tabs" role="tablist">
        {[
          ["REASSIGN", "Maliyeti değiştir"],
          ["SOURCE", "Kaynağı değiştir"],
          ["REPLACEMENT", "Yeni kayıtla değiştir"],
          ["REPLACE", "Başka kalemle değiştir"],
          ["SPLIT", "Mappingleri ayır"],
        ].map(([value, label]) => (
          <button key={value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>
            {label}
          </button>
        ))}
      </div>
      {mode === "SPLIT" && (
        <div className="split-mapping-list">
          {(context?.mappings || []).map((row) => (
            <button
              key={row.id}
              className={`${splitAssignments[row.id] ? "assigned" : ""} ${Number(splitActiveMappingId) === Number(row.id) ? "active" : ""}`}
              onClick={() => setSplitActiveMappingId(row.id)}
            >
              <span>{row.marketplace} · {row.product_name || row.barcode}</span>
              <b>{row.quantity} adet</b>
              <small>
                {Number(splitActiveMappingId) === Number(row.id)
                  ? "Bu mapping için aşağıdan hedef seçin"
                  : splitAssignments[row.id]
                    ? `Hedef #${splitAssignments[row.id]}`
                    : "Hedef seçilmedi"}
              </small>
            </button>
          ))}
          <p>Bir mappinge dokunun, ardından aşağıdan doğru hedef maliyeti seçin.</p>
        </div>
      )}
      {!context ? (
        <Loading label="Maliyet bağlantıları yükleniyor" />
      ) : (
        <CostSelector
          onSelect={openTarget}
          requireCanonical={!(["SOURCE", "REPLACEMENT"].includes(mode))}
          onManualSubmit={manualPreview}
        />
      )}
      {mode === "SPLIT" && (
        <Button icon={Scissors} onClick={previewSplit}>Ayırmayı önizle</Button>
      )}
      {selectedOffer?.offer_type === "MANUAL" && (
        <details className="manual-edit-details">
          <summary>Manuel maliyeti düzenle</summary>
          <ManualCostForm
            initial={{
              itemName: current.item_name,
              unitCost: current.unit_cost,
              physicalSupplierCode: selectedOffer.physical_supplier_code,
              checkedAt: selectedOffer.checked_at,
            }}
            showDesi={false}
            onSubmit={editManual}
          />
        </details>
      )}
      <div className="cost-danger-actions">
        <Button
          variant="secondary"
          icon={Archive}
          disabled={!current || Boolean(context?.mappings?.length)}
          onClick={() => operation.open("ARCHIVE_COST_ITEM", { costItemId: current.id })}
        >
          Kaldır
        </Button>
        {context?.hardDeleteEligibility?.eligible && (
          <Button
            variant="danger"
            icon={Trash2}
            onClick={() => operation.open("HARD_DELETE_COST_ITEM", { costItemId: current.id })}
          >
            Kalıcı sil
          </Button>
        )}
      </div>
      {context && !context.hardDeleteEligibility?.eligible && (
        <small>Bu kayıt daha önce kullanıldığı için kalıcı silinemez; arşivlenebilir.</small>
      )}
      {Boolean(context?.mappings?.length) && (
        <small>Kaldırmadan önce mappingleri ayırın veya başka maliyet kalemine taşıyın.</small>
      )}
      {operation.lastOperation && operation.lastOperation.operation_type !== "HARD_DELETE_COST_ITEM" && (
        <div className="cost-operation-success">
          <span>İşlem başarıyla tamamlandı.</span>
          <Button variant="secondary" icon={RotateCcw} disabled={operation.busy} onClick={operation.undo}>
            Geri al
          </Button>
        </div>
      )}
      <ImpactPreviewModal
        preview={operation.preview}
        busy={operation.busy}
        onClose={operation.close}
        onConfirm={operation.apply}
      />
    </section>
  );
}
