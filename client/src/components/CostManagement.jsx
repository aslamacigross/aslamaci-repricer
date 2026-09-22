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

const WARNING_MESSAGES = {
  TARGET_DESI_MISSING:
    "Bu maliyet kaleminde birim desi tanımlı değil. Maliyet Kalemleri ekranından birim desi tanımlayın.",
};

function quantityError(value) {
  if (value === "" || value == null) return "Ürün adedi zorunludur.";
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number))
    return "Ürün adedi tam sayı olmalıdır.";
  if (number < 1) return "Ürün adedi en az 1 olmalıdır.";
  return "";
}

function desi(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    maximumFractionDigits: 4,
  });
}

function unitDesiError(value) {
  if (value === "" || value == null) return "Birim desi zorunludur.";
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    return "Birim desi pozitif sayı olmalıdır.";
  return "";
}

export function CanonicalDesiEditor({
  costItemId,
  itemCode,
  unitDesi,
  quantity = 1,
  product,
  knownMappings,
  notify,
  onSaved,
}) {
  const [draft, setDraft] = useState(String(unitDesi ?? ""));
  const [persisted, setPersisted] = useState(Number(unitDesi || 0));
  const [mappings, setMappings] = useState(knownMappings || []);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState("");

  useEffect(() => {
    setDraft(String(unitDesi ?? ""));
    setPersisted(Number(unitDesi || 0));
    setValidation("");
    setConfirming(false);
  }, [costItemId, itemCode, unitDesi]);

  useEffect(() => {
    if (Array.isArray(knownMappings)) {
      setMappings(knownMappings);
      return undefined;
    }
    if (!costItemId) {
      setMappings([]);
      return undefined;
    }
    let active = true;
    setLoadingImpact(true);
    get(`/api/cost-integrity/cost-items/${costItemId}/context`)
      .then((response) => active && setMappings(response.data?.mappings || []))
      .catch((error) => notify?.(errorMessage(error), "error"))
      .finally(() => active && setLoadingImpact(false));
    return () => {
      active = false;
    };
  }, [costItemId, knownMappings]);

  if (!costItemId || !itemCode) return null;
  const numericDesi = Number(draft);
  const numericQuantity = Number(quantity);
  const validQuantity =
    Number.isInteger(numericQuantity) && numericQuantity >= 1;
  const error = unitDesiError(draft);
  const changed = !error && numericDesi !== persisted;
  const marketplaceCounts = mappings.reduce(
    (counts, mapping) => ({
      ...counts,
      [mapping.marketplace]: (counts[mapping.marketplace] || 0) + 1,
    }),
    {},
  );
  const totalDesi =
    !error && validQuantity ? Math.ceil(numericDesi * numericQuantity) : null;
  const hasOverride = product?.manual_desi_override != null;

  function prepare() {
    setValidation(error);
    if (error) {
      notify?.(error, "error");
      return;
    }
    setConfirming(true);
  }

  async function save() {
    setSaving(true);
    try {
      const response = await post(
        `/api/cost-items/desi-review/${encodeURIComponent(itemCode)}/resolve`,
        { unit_desi: numericDesi },
      );
      const saved = response.data;
      setPersisted(Number(saved.unit_desi));
      setDraft(String(saved.unit_desi));
      setConfirming(false);
      setValidation("");
      onSaved?.(saved);
      notify?.("Ortak birim desi güncellendi");
    } catch (saveError) {
      notify?.(errorMessage(saveError), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="canonical-desi-editor">
      <div className="canonical-desi-heading">
        <div>
          <strong>Ambalaj / Kargo</strong>
          <small>Bu alan maliyet kaleminin ortak birim desisidir.</small>
        </div>
        {loadingImpact && <small>Etki hesaplanıyor...</small>}
      </div>
      <div className="canonical-desi-fields">
        <Field label="Birim desi">
          <input
            aria-label="Canonical birim desi"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setValidation("");
            }}
          />
        </Field>
        <div className="canonical-desi-total">
          <span>Toplam desi</span>
          <b>
            {totalDesi == null
              ? "Geçerli birim desi girin"
              : `ceil(${desi(numericDesi)} × ${numericQuantity}) = ${desi(totalDesi)}`}
          </b>
        </div>
      </div>
      {validation && <p className="cost-selector-error">{validation}</p>}
      {hasOverride && (
        <p className="cost-selector-warning">
          Bu üründe manuel desi override aktif: {desi(product.manual_desi_override)}.
          Canonical desi güncellense de override otomatik kaldırılmaz.
        </p>
      )}
      <Button
        variant="secondary"
        disabled={!changed || saving}
        onClick={prepare}
      >
        Desiyi güncelle
      </Button>
      {confirming && (
        <Modal
          open
          onClose={() => setConfirming(false)}
          title="Ortak birim desiyi güncelle"
        >
          <div className="modal-body">
            <div className="cost-change-summary">
              <span>Mevcut birim desi</span><b>{desi(persisted)}</b>
              <span>Yeni birim desi</span><b>{desi(numericDesi)}</b>
              <span>Bu mapping için toplam desi</span><b>{desi(totalDesi)}</b>
            </div>
            {mappings.length > 0 && (
              <div className="info-banner canonical-desi-impact">
                <div>
                  <strong>Bu desi maliyet kaleminin ortak birim desisidir.</strong>
                  <p>
                    Trendyol: {marketplaceCounts.TRENDYOL || 0} mapping ·
                    Hepsiburada: {marketplaceCounts.HEPSIBURADA || 0} mapping
                  </p>
                </div>
              </div>
            )}
            {hasOverride && (
              <p className="cost-selector-warning">
                Bu üründeki {desi(product.manual_desi_override)} manuel desi
                override değeri korunacaktır.
              </p>
            )}
          </div>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              İptal
            </Button>
            <Button disabled={saving} onClick={save}>
              Desiyi güncelle
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function QuantityPackagingSummary({ quantity, unitCost, unitDesi, product }) {
  const numericQuantity = Number(quantity);
  const validQuantity = Number.isInteger(numericQuantity) && numericQuantity >= 1;
  const numericUnitCost = Number(unitCost || 0);
  const numericUnitDesi = Number(unitDesi || 0);
  const calculatedDesi = validQuantity ? numericQuantity * numericUnitDesi : 0;
  const hasOverride = product?.manual_desi_override != null;

  return (
    <div className="assignment-calculation" aria-label="Maliyet ve ambalaj özeti">
      <div>
        <span>Birim maliyet</span>
        <b>{money(numericUnitCost)}</b>
      </div>
      <div>
        <span>Ürün adedi</span>
        <b>{validQuantity ? numericQuantity : "-"}</b>
      </div>
      <div className="assignment-total">
        <span>Toplam ürün maliyeti</span>
        <b>
          {validQuantity
            ? `${numericQuantity} × ${money(numericUnitCost)} = ${money(numericQuantity * numericUnitCost)}`
            : "Geçerli ürün adedi girin"}
        </b>
      </div>
      <div>
        <span>Birim desi</span>
        <b>{numericUnitDesi > 0 ? desi(numericUnitDesi) : "Tanımlı değil"}</b>
      </div>
      <div>
        <span>Mapping toplam desi</span>
        <b>
          {numericUnitDesi > 0 && validQuantity
            ? `${desi(numericUnitDesi)} × ${numericQuantity} = ${desi(calculatedDesi)}`
            : "-"}
        </b>
      </div>
      <div>
        <span>Mevcut kargoda kullanılan desi</span>
        <b>
          {hasOverride
            ? `${desi(product.manual_desi_override)} · Manuel override`
            : product?.desi != null
              ? desi(product.desi)
              : "Mapping kaydedilince hesaplanır"}
        </b>
      </div>
      <div>
        <span>Değişiklik sonrası tahmini desi</span>
        <b>
          {hasOverride
            ? `${desi(product.manual_desi_override)} · Manuel override korunur`
            : numericUnitDesi > 0 && validQuantity
              ? desi(Math.ceil(calculatedDesi))
              : "-"}
        </b>
      </div>
      {product?.packaging_profile_name && (
        <div className="assignment-total">
          <span>Mevcut ambalaj profili</span>
          <b>{product.packaging_profile_name}</b>
        </div>
      )}
      {numericUnitDesi <= 0 && (
        <p className="cost-selector-warning assignment-total">
          Desi tanımlı değil. Maliyet Kalemleri ekranından birim desi tanımlayın.
        </p>
      )}
    </div>
  );
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
                  {item.linked_unit_desi != null && (
                    <small>
                      Birim desi: {Number(item.linked_unit_desi) > 0
                        ? desi(item.linked_unit_desi)
                        : "Tanımlı değil"}
                    </small>
                  )}
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
  const hasAssignmentCalculation = impact.targetQuantity != null;
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
        {hasAssignmentCalculation ? (
          <div className="cost-change-summary assignment-preview-summary">
            {impact.currentQuantity != null && (
              <>
                <span>Mevcut ürün maliyeti</span>
                <b>
                  {impact.currentQuantity} × {money(impact.currentUnitCost)} ={" "}
                  {money(impact.currentLineCost)}
                </b>
              </>
            )}
            <span>Birim maliyet</span><b>{money(impact.targetUnitCost)}</b>
            <span>Ürün adedi</span><b>{impact.targetQuantity}</b>
            <span>Toplam ürün maliyeti</span>
            <b>
              {impact.targetQuantity} × {money(impact.targetUnitCost)} ={" "}
              {money(impact.targetLineCost)}
            </b>
            <span>Birim desi</span>
            <b>
              {Number(impact.targetUnitDesi) > 0
                ? desi(impact.targetUnitDesi)
                : "Tanımlı değil"}
            </b>
            <span>Mapping toplam desi</span>
            <b>
              {Number(impact.targetUnitDesi) > 0
                ? `${desi(impact.targetUnitDesi)} × ${impact.targetQuantity} = ${desi(impact.targetTotalDesi)}`
                : "-"}
            </b>
            {impact.manualDesiOverride != null && (
              <>
                <span>Kargoda kullanılan desi</span>
                <b>{desi(impact.manualDesiOverride)} · Manuel override</b>
              </>
            )}
            {impact.targetEffectiveProductDesi != null && (
              <>
                <span>Değişiklik sonrası tahmini desi</span>
                <b>
                  {desi(impact.targetEffectiveProductDesi)}
                  {impact.manualDesiOverride != null
                    ? " · Manuel override korunur"
                    : ""}
                </b>
              </>
            )}
            {impact.packagingProfileName && (
              <>
                <span>Mevcut ambalaj profili</span>
                <b>{impact.packagingProfileName}</b>
              </>
            )}
          </div>
        ) : (
          <div className="cost-change-summary">
            <span>Mevcut maliyet</span><b>{money(impact.currentUnitCost)}</b>
            <span>Yeni maliyet</span><b>{money(impact.targetUnitCost)}</b>
          </div>
        )}
        {(impact.mappings || []).map((mapping) => (
          <div className="mapping-row" key={mapping.id || `${mapping.marketplace}:${mapping.barcode}`}>
            <div>
              <strong>{mapping.productName || mapping.barcode}</strong>
              <small>{mapping.marketplace} · {mapping.barcode} · {mapping.quantity} adet</small>
            </div>
          </div>
        ))}
        {(preview.warnings || []).map((warning) => (
          <p className="cost-selector-warning" key={warning}>
            {WARNING_MESSAGES[warning] || warning}
          </p>
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

function AssignmentControls({
  quantity,
  onQuantityChange,
  error,
  unitCost,
  unitDesi,
  costItemId,
  itemCode,
  mappings,
  product,
  targetName,
  onPreview,
  disabled,
  notify,
}) {
  const [resolvedUnitDesi, setResolvedUnitDesi] = useState(unitDesi);
  useEffect(() => setResolvedUnitDesi(unitDesi), [costItemId, unitDesi]);
  return (
    <div className="assignment-controls">
      {targetName && (
        <div className="assignment-target">
          <span>Seçilen maliyet kalemi</span>
          <strong>{targetName}</strong>
        </div>
      )}
      <Field label="Ürün Adedi">
        <input
          aria-label="Ürün Adedi"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={quantity}
          onChange={(event) => onQuantityChange(event.target.value)}
        />
      </Field>
      {error && <p className="cost-selector-error">{error}</p>}
      <CanonicalDesiEditor
        costItemId={costItemId}
        itemCode={itemCode}
        unitDesi={resolvedUnitDesi}
        quantity={quantity}
        product={product}
        knownMappings={mappings}
        notify={notify}
        onSaved={(item) => setResolvedUnitDesi(item.unit_desi)}
      />
      <QuantityPackagingSummary
        quantity={quantity}
        unitCost={unitCost}
        unitDesi={resolvedUnitDesi}
        product={product}
      />
      <Button disabled={disabled} onClick={onPreview}>
        Değişikliği önizle
      </Button>
    </div>
  );
}

export function CostAssignmentEditor({
  marketplace,
  barcode,
  mappings = [],
  product,
  onChanged,
  notify,
}) {
  const [mappingId, setMappingId] = useState(mappings[0]?.id || "");
  const [context, setContext] = useState(null);
  const [mode, setMode] = useState("REASSIGN");
  const [quantity, setQuantity] = useState(String(mappings[0]?.quantity ?? 1));
  const [quantityValidation, setQuantityValidation] = useState("");
  const [targetOffer, setTargetOffer] = useState(null);
  const [splitAssignments, setSplitAssignments] = useState({});
  const [splitActiveMappingId, setSplitActiveMappingId] = useState(null);
  const operation = useOperation({ notify, onChanged });
  const mapping = mappings.find((row) => Number(row.id) === Number(mappingId));

  useEffect(() => {
    if (!mappings.some((row) => Number(row.id) === Number(mappingId)))
      setMappingId(mappings[0]?.id || "");
  }, [mappings, mappingId]);

  useEffect(() => {
    setQuantity(String(mapping?.quantity ?? 1));
    setQuantityValidation("");
    setTargetOffer(null);
  }, [mapping?.id, mapping?.quantity]);

  useEffect(() => {
    setTargetOffer(null);
  }, [mode]);

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
  const checkedQuantity = () => {
    const message = quantityError(quantity);
    setQuantityValidation(message);
    if (message) {
      notify?.(message, "error");
      return null;
    }
    return Number(quantity);
  };
  const assignmentPreview = () => {
    const normalizedQuantity = checkedQuantity();
    if (normalizedQuantity == null) return;
    if (!mapping && !targetOffer) {
      notify?.("Önce bir maliyet kalemi seçin.", "error");
      return;
    }
    operation.open(mapping ? "REASSIGN_PRODUCT_COST" : "ASSIGN_PRODUCT_COST", {
      marketplace,
      barcode,
      ...(mapping
        ? {
            sourceCostItemId: mapping.cost_item_id,
            targetCostItemId:
              targetOffer?.canonical_cost_item_id || mapping.cost_item_id,
          }
        : { targetCostItemId: targetOffer.canonical_cost_item_id }),
      quantity: normalizedQuantity,
    });
  };
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
    setTargetOffer(offer);
    setQuantityValidation("");
  };

  const manualPreview = (form) => {
    const normalizedQuantity = checkedQuantity();
    if (normalizedQuantity == null) return;
    operation.open("CREATE_MANUAL_COST", {
      marketplace,
      barcode,
      sourceCostItemId: mapping?.cost_item_id || null,
      itemCode: `MANUAL_${barcode}_${Date.now()}`.replace(/[^A-Z0-9_]/gi, "_").toUpperCase(),
      itemName: form.itemName,
      unitCost: form.unitCost,
      unitDesi: form.unitDesi,
      quantity: normalizedQuantity,
      physicalSupplierCode: form.physicalSupplierCode,
      checkedAt: form.checkedAt,
    });
  };

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
          selectedId={targetOffer?.id}
          onSelect={(selected) => {
            setTargetOffer(selected);
            setQuantityValidation("");
          }}
          onManualSubmit={manualPreview}
        />
        <AssignmentControls
          quantity={quantity}
          onQuantityChange={(value) => {
            setQuantity(value);
            setQuantityValidation("");
          }}
          error={quantityValidation}
          unitCost={targetOffer?.linked_unit_cost ?? targetOffer?.current_price}
          unitDesi={targetOffer?.linked_unit_desi}
          costItemId={targetOffer?.canonical_cost_item_id}
          itemCode={targetOffer?.canonical_item_code}
          product={product}
          targetName={targetOffer?.linked_cost_item_name || targetOffer?.product_name}
          onPreview={assignmentPreview}
          disabled={!targetOffer}
          notify={notify}
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
      {mode === "REASSIGN" && (
        <AssignmentControls
          quantity={quantity}
          onQuantityChange={(value) => {
            setQuantity(value);
            setQuantityValidation("");
          }}
          error={quantityValidation}
          unitCost={
            targetOffer?.linked_unit_cost ??
            targetOffer?.current_price ??
            current?.unit_cost ??
            mapping.unit_cost
          }
          unitDesi={
            targetOffer?.linked_unit_desi ?? current?.unit_desi ?? mapping.unit_desi
          }
          costItemId={targetOffer?.canonical_cost_item_id || current?.id}
          itemCode={targetOffer?.canonical_item_code || current?.item_code}
          mappings={
            !targetOffer ||
            Number(targetOffer.canonical_cost_item_id) === Number(current?.id)
              ? context?.mappings
              : undefined
          }
          product={product}
          targetName={
            targetOffer?.linked_cost_item_name ||
            targetOffer?.product_name ||
            current?.item_name ||
            mapping.item_name
          }
          onPreview={assignmentPreview}
          disabled={
            !current ||
            (!targetOffer && Number(quantity) === Number(mapping.quantity))
          }
          notify={notify}
        />
      )}
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
          selectedId={targetOffer?.id}
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
