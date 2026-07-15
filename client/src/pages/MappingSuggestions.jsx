import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  DatabaseZap,
  Eye,
  FileUp,
  Play,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { get, post } from "../lib/api";
import DataTable, { date, money, percent } from "../components/DataTable";
import {
  Badge,
  Button,
  Drawer,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Loading,
  Modal,
  Pagination,
  SearchInput,
} from "../components/ui";

const statusLabels = {
  PENDING: "Bekliyor",
  APPROVED: "Onaylandı",
  APPLIED: "Uygulandı",
  REJECTED: "Reddedildi",
  STALE: "Geçersiz kaldı",
};

const confidenceLabels = {
  HIGH: "Yüksek güven",
  REVIEW: "Kontrol gerekli",
  LOW: "Düşük güven",
};

const reasonLabels = {
  NAME_SIMILARITY: "Ürün adı benzerliği",
  BRAND_MATCH: "Marka eşleşiyor",
  BRAND_MISMATCH: "Marka farklı",
  SIZE_MATCH: "Gramaj / hacim eşleşiyor",
  SIZE_MISMATCH: "Gramaj / hacim farklı",
  CATEGORY_MATCH: "Kategori eşleşiyor",
};

function confidenceTone(band) {
  if (band === "HIGH") return "success";
  if (band === "REVIEW") return "warning";
  return "danger";
}

function statusTone(status) {
  if (status === "APPLIED") return "success";
  if (status === "APPROVED") return "info";
  if (status === "PENDING") return "warning";
  return "danger";
}

function ProductImage({ product }) {
  return (
    <span className="mapping-product-image">
      <img
        src={`/api/products/${encodeURIComponent(product.barcode)}/image`}
        alt={product.product_name || "Ürün görseli"}
        onError={(event) => {
          event.currentTarget.style.display = "none";
          event.currentTarget.nextElementSibling.style.display = "grid";
        }}
      />
      <span>Görsel yok</span>
    </span>
  );
}

function suggestionSummary(row) {
  return row.items
    .map(
      (item) =>
        `${item.item_name || item.cost_item_code} x ${Number(item.quantity)}`,
    )
    .join(" + ");
}

function hasVariantPrice(row) {
  return Boolean(row.evidence?.variantPriceInferred);
}

export default function MappingSuggestions({ view, notify }) {
  if (view === "file") return <FileMarketPool notify={notify} />;
  if (view === "learning") return <MappingLearningHistory />;
  return <SuggestionQueue notify={notify} />;
}

function learningImpact(value) {
  const points = Number(value || 0) * 100;
  return `${points > 0 ? "+" : ""}${points.toLocaleString("tr-TR", {
    maximumFractionDigits: 2,
  })} puan`;
}

function MappingLearningHistory() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState("");
  const [page, setPage] = useState(1);

  async function load() {
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      if (decision) params.set("decision", decision);
      setResult((await get(`/api/mapping-learning/feedback?${params}`)).data);
    } catch (nextError) {
      setError(nextError);
    }
  }

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [search, decision, page]);

  useEffect(() => setPage(1), [search, decision]);

  const columns = useMemo(
    () => [
      {
        key: "created_at",
        label: "Tarih",
        render: (row) => date(row.created_at),
      },
      { key: "barcode", label: "Barkod" },
      { key: "product_name", label: "Trendyol ürünü", width: 320 },
      {
        key: "decision",
        label: "Karar",
        render: (row) => (
          <Badge tone={row.decision === "APPROVED" ? "success" : "danger"}>
            {row.decision === "APPROVED" ? "Onaylandı" : "Reddedildi"}
          </Badge>
        ),
      },
      {
        key: "items",
        label: "Cost Code",
        render: (row) =>
          (row.items || []).map((item) => item.cost_item_code).join(" + ") ||
          "-",
      },
      {
        key: "confidence",
        label: "Karar anı güveni",
        render: (row) => percent(Number(row.confidence) * 100),
      },
      {
        key: "learning_adjustment",
        label: "Öğrenme etkisi",
        render: (row) => learningImpact(row.learning_adjustment),
      },
      {
        key: "profile",
        label: "Örüntü geçmişi",
        render: (row) =>
          `${Number(row.accepted_count || 0)} onay / ${Number(row.rejected_count || 0)} ret`,
      },
      { key: "actor", label: "Kullanıcı" },
      { key: "reason", label: "Ret notu", width: 260 },
    ],
    [],
  );

  return (
    <>
      <div className="mapping-toolbar">
        <div className="filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Barkod veya Trendyol ürünü ara"
          />
          <select
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
          >
            <option value="">Tüm kararlar</option>
            <option value="APPROVED">Onaylananlar</option>
            <option value="REJECTED">Reddedilenler</option>
          </select>
        </div>
        <IconButton icon={RefreshCw} label="Yenile" onClick={load} />
      </div>
      <div className="info-banner">
        <DatabaseZap />
        <div>
          <strong>Her karar öğrenme verisidir</strong>
          <p>
            Benzer ürün ailesi ve cost code kararları biriktikçe sonraki güven
            skorları kontrollü olarak yükselir veya düşer.
          </p>
        </div>
      </div>
      {!result && !error ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={load} />
      ) : result.items.length ? (
        <div className="panel table-panel">
          <DataTable
            columns={columns}
            rows={result.items}
            rowKey={(row) => Number(row.id)}
            columnVisibilityKey="mapping-learning-feedback"
          />
          <Pagination
            page={result.page}
            total={result.total}
            limit={result.limit}
            onChange={setPage}
          />
        </div>
      ) : (
        <Empty label="Henüz onay veya ret kararı yok" />
      )}
    </>
  );
}

function SuggestionQueue({ notify }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [confidence, setConfidence] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [detail, setDetail] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkApplyIds, setBulkApplyIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (confidence) params.set("confidenceBand", confidence);
      const response = await get(`/api/mapping-suggestions?${params}`);
      setResult(response.data);
      setSelectedIds([]);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [search, status, confidence, page]);

  useEffect(() => setPage(1), [search, status, confidence]);

  async function generate() {
    setGenerating(true);
    try {
      const response = await post("/api/mapping-suggestions/generate", {
        limit: 1000,
      });
      const data = response.data;
      notify(
        `${data.created} yeni öneri üretildi; ${data.processed} ürün tarandı, ${data.scoped} File markası kapsamındaydı, ${data.withoutCandidate || 0} üründe güvenli aday kalmadı`,
      );
      setStatus("PENDING");
      await load();
    } catch (nextError) {
      notify(nextError.message, "error");
    } finally {
      setGenerating(false);
    }
  }

  async function previewSelected(ids = selectedIds) {
    setBulkBusy(true);
    try {
      const response = await post("/api/mapping-suggestions/bulk-preview", {
        ids,
      });
      setBulkApplyIds(ids);
      setBulkPreview(response.data);
    } catch (nextError) {
      notify(nextError.message, "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function applySelected() {
    setBulkBusy(true);
    try {
      const response = await post("/api/mapping-suggestions/bulk-apply", {
        ids: bulkApplyIds,
        previewToken: bulkPreview.token,
      });
      notify(`${response.data.applied} ürünün mappingi güvenle uygulandı`);
      setBulkPreview(null);
      setBulkApplyIds([]);
      setDetail(null);
      await load();
    } catch (nextError) {
      notify(nextError.message, "error");
      setBulkPreview(null);
      setBulkApplyIds([]);
    } finally {
      setBulkBusy(false);
    }
  }

  function closeBulkPreview() {
    setBulkPreview(null);
    setBulkApplyIds([]);
  }

  const columns = useMemo(
    () => [
      {
        key: "image",
        label: "Görsel",
        sortable: false,
        exportable: false,
        render: (row) => <ProductImage product={row} />,
      },
      { key: "barcode", label: "Barkod" },
      { key: "product_name", label: "Trendyol ürünü", width: 300 },
      {
        key: "mapping",
        label: "Önerilen eşleşme",
        width: 310,
        render: suggestionSummary,
        exportValue: suggestionSummary,
      },
      {
        key: "file_product_name",
        label: "File ürünü",
        render: (row) => (
          <div className="confidence-cell">
            <span>
              {row.file_product_name ||
                row.items.find((item) => item.file_product_name)
                  ?.file_product_name ||
                "-"}
            </span>
            {hasVariantPrice(row) && (
              <Badge tone="warning">Varyant fiyatı</Badge>
            )}
          </div>
        ),
      },
      {
        key: "file_current_price",
        label: "File fiyatı",
        render: (row) => {
          const price =
            row.file_current_price ||
            row.items.find((item) => item.file_current_price)
              ?.file_current_price;
          return price ? money(price) : "-";
        },
      },
      {
        key: "confidence",
        label: "Güven",
        render: (row) => (
          <div className="confidence-cell">
            <strong>{percent(Number(row.confidence) * 100)}</strong>
            <Badge tone={confidenceTone(row.confidence_band)}>
              {confidenceLabels[row.confidence_band]}
            </Badge>
          </div>
        ),
      },
      {
        key: "source_type",
        label: "Kaynak",
        render: (row) =>
          hasVariantPrice(row)
            ? "Eski mapping + kardeş varyant"
            : row.source_type === "MANUAL_HISTORY_AND_FILE"
              ? "Eski mapping + File"
              : row.source_type === "MANUAL_HISTORY"
                ? "Eski mapping"
                : row.source_type === "FILE_MARKET"
                  ? "File + maliyet kataloğu"
                  : "Maliyet kataloğu",
      },
      {
        key: "status",
        label: "Durum",
        render: (row) => (
          <Badge tone={statusTone(row.status)}>
            {statusLabels[row.status]}
          </Badge>
        ),
      },
      {
        key: "ops",
        label: "İşlem",
        sortable: false,
        exportable: false,
        render: (row) => (
          <div
            className="row-actions"
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton
              icon={Eye}
              label="Öneriyi incele"
              onClick={() => setDetail(row)}
            />
            {row.status === "PENDING" && (
              <IconButton
                icon={Check}
                label="Onay ayrıntılarını aç"
                onClick={() => setDetail(row)}
              />
            )}
            {row.status === "APPROVED" && (
              <IconButton
                icon={Play}
                label="Mapping uygulama önizlemesi"
                onClick={() => previewSelected([Number(row.id)])}
              />
            )}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <div className="mapping-toolbar">
        <div className="filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Barkod veya Trendyol ürünü ara"
          />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Tüm durumlar</option>
            <option value="PENDING">Bekleyenler</option>
            <option value="APPROVED">Onaylananlar</option>
            <option value="APPLIED">Uygulananlar</option>
            <option value="REJECTED">Reddedilenler</option>
            <option value="STALE">Geçersiz kalanlar</option>
          </select>
          <select
            value={confidence}
            onChange={(event) => setConfidence(event.target.value)}
          >
            <option value="">Tüm güven düzeyleri</option>
            <option value="HIGH">Yüksek güven</option>
            <option value="REVIEW">Kontrol gerekli</option>
            <option value="LOW">Düşük güven</option>
          </select>
        </div>
        <div className="mapping-toolbar-actions">
          <Button
            variant="secondary"
            icon={Play}
            disabled={!selectedIds.length || bulkBusy}
            onClick={() => previewSelected(selectedIds)}
          >
            Seçilenleri önizle ({selectedIds.length})
          </Button>
          <Button icon={Sparkles} disabled={generating} onClick={generate}>
            {generating ? "Üretiliyor" : "Önerileri üret"}
          </Button>
          <IconButton icon={RefreshCw} label="Yenile" onClick={load} />
        </div>
      </div>
      <div className="info-banner">
        <DatabaseZap />
        <div>
          <strong>Öneri onayı mappingi değiştirmez</strong>
          <p>
            Onay kararları öğrenme verisi olarak kaydedilir. Gerçek maliyet
            mappingi için onaylanan satırları ayrıca önizleyip uygulayın.
          </p>
        </div>
      </div>
      {loading && !result ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={load} />
      ) : result?.items.length ? (
        <div className="panel table-panel">
          <DataTable
            columns={columns}
            rows={result.items}
            rowKey={(row) => Number(row.id)}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            canSelectRow={(row) => row.status === "APPROVED"}
            onRowClick={setDetail}
            columnVisibilityKey="mapping-suggestions"
          />
          <Pagination
            page={result.page}
            total={result.total}
            limit={result.limit}
            onChange={setPage}
          />
        </div>
      ) : (
        <Empty label="Bu filtrelerde mapping önerisi yok" />
      )}
      <SuggestionDrawer
        suggestion={detail}
        onClose={() => setDetail(null)}
        onChanged={async () => {
          setDetail(null);
          await load();
        }}
        onApproved={async () => {
          setDetail(null);
          setStatus("APPROVED");
          setPage(1);
          notify(
            "Öneri onaylandı; Onaylananlar sekmesinden mappinge uygulanabilir",
          );
        }}
        onPreviewApply={(id) => {
          setDetail(null);
          previewSelected([Number(id)]);
        }}
        notify={notify}
      />
      <BulkApplyModal
        preview={bulkPreview}
        busy={bulkBusy}
        onClose={closeBulkPreview}
        onApply={applySelected}
      />
    </>
  );
}

function SuggestionDrawer({
  suggestion,
  onClose,
  onChanged,
  onApproved,
  onPreviewApply,
  notify,
}) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  useEffect(() => {
    if (!suggestion) return setForm(null);
    setForm({
      update_file_price: Boolean(suggestion.update_file_price),
      items: suggestion.items.map((item) => ({
        cost_item_code: item.cost_item_code,
        quantity: Number(item.quantity),
        file_market_item_id: item.file_market_item_id,
        suggested_unit_cost: Number(
          item.file_current_price || item.suggested_unit_cost || 0,
        ),
      })),
    });
    setRejectionReason("");
  }, [suggestion]);

  if (!suggestion || !form) return null;

  function updateItem(index, field, value) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  }

  async function approve() {
    setBusy(true);
    try {
      await post(`/api/mapping-suggestions/${suggestion.id}/approve`, form);
      await onApproved();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await post(`/api/mapping-suggestions/${suggestion.id}/reject`, {
        reason: rejectionReason,
      });
      notify("Öneri reddedildi");
      await onChanged();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const evidence = suggestion.evidence || {};
  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={`${suggestion.barcode} mapping önerisi`}
    >
      <div className="mapping-suggestion-detail">
        <div className="mapping-product-hero">
          <ProductImage product={suggestion} />
          <div>
            <span>{suggestion.barcode}</span>
            <h3>{suggestion.product_name}</h3>
            <small>{suggestion.category_name || "Kategori yok"}</small>
          </div>
          <Badge tone={statusTone(suggestion.status)}>
            {statusLabels[suggestion.status]}
          </Badge>
        </div>
        <div className="metric-row">
          <div>
            <span>Güven skoru</span>
            <b>{percent(Number(suggestion.confidence) * 100)}</b>
          </div>
          <div>
            <span>Güven düzeyi</span>
            <b>{confidenceLabels[suggestion.confidence_band]}</b>
          </div>
          <div>
            <span>Kaynak barkod</span>
            <b>{suggestion.source_barcode || "Doğrudan eşleşme"}</b>
          </div>
          <div>
            <span>File fiyat tarihi</span>
            <b>{date(suggestion.file_last_seen_at)}</b>
          </div>
        </div>
        <section>
          <h3>Önerilen maliyet reçetesi</h3>
          <div className="suggestion-items">
            {suggestion.items.map((item, index) => (
              <div key={item.id || `${item.cost_item_code}:${index}`}>
                <div className="suggestion-item-heading">
                  <strong>{item.item_name || item.cost_item_code}</strong>
                  <Badge tone={item.file_market_item_id ? "info" : "neutral"}>
                    {item.file_market_item_id
                      ? evidence.fileMatches?.find(
                          (match) =>
                            match.costItemCode === item.cost_item_code &&
                            match.priceMode === "SIBLING_VARIANT",
                        )
                        ? "Varyant fiyatından türetildi"
                        : "File fiyatı bulundu"
                      : "Mevcut fiyat"}
                  </Badge>
                </div>
                <div className="form-grid">
                  <Field label="Cost Code">
                    <input
                      value={form.items[index].cost_item_code}
                      disabled={suggestion.status !== "PENDING"}
                      onChange={(event) =>
                        updateItem(index, "cost_item_code", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Adet">
                    <input
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      value={form.items[index].quantity}
                      disabled={suggestion.status !== "PENDING"}
                      onChange={(event) =>
                        updateItem(
                          index,
                          "quantity",
                          Number(event.target.value),
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="compact-kv">
                  <span>Mevcut birim maliyet</span>
                  <b>{money(item.unit_cost || item.current_unit_cost)}</b>
                  <span>File ürünü</span>
                  <b>{item.file_product_name || "Eşleşme yok"}</b>
                  <span>File güncel fiyatı</span>
                  <b>
                    {item.file_current_price
                      ? money(item.file_current_price)
                      : "-"}
                  </b>
                  <span>Birim desi</span>
                  <b>{item.unit_desi || "-"}</b>
                </div>
              </div>
            ))}
          </div>
        </section>
        {suggestion.items.some((item) => item.file_market_item_id) && (
          <label className="setting-toggle mapping-price-toggle">
            <input
              type="checkbox"
              checked={form.update_file_price}
              disabled={suggestion.status !== "PENDING"}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  update_file_price: event.target.checked,
                }))
              }
            />
            <span>
              File fiyatını ilgili maliyet kalemine uygula
              <small>
                Uygulama anındaki güncel File fiyatı kullanılır ve eski fiyat
                geçmişte korunur.
              </small>
            </span>
          </label>
        )}
        {evidence.learning && (
          <section>
            <h3>Öğrenme durumu</h3>
            <div className="compact-kv">
              <span>Benzer örüntü onayı</span>
              <b>{Number(evidence.learning.accepted || 0)}</b>
              <span>Benzer örüntü reddi</span>
              <b>{Number(evidence.learning.rejected || 0)}</b>
              <span>Bu skora etkisi</span>
              <b>{learningImpact(evidence.learning.adjustment)}</b>
              <span>Varyant yüksek güven kilidi</span>
              <b>
                {evidence.learning.variantPromotionUnlocked
                  ? "Yeterli doğrulama var"
                  : "En az 5 karar ve %90 onay gerekir"}
              </b>
            </div>
          </section>
        )}
        <section>
          <h3>Bu öneri neden geldi?</h3>
          <div className="evidence-list">
            {(evidence.reasons || []).map((reason, index) => (
              <div key={`${reason.code}:${index}`}>
                <Check size={15} />
                <span>{reasonLabels[reason.code] || reason.code}</span>
                {reason.value !== undefined && (
                  <b>{percent(Number(reason.value) * 100)}</b>
                )}
              </div>
            ))}
            {evidence.sourceProductName && (
              <div>
                <DatabaseZap size={15} />
                <span>Örnek alınan eski ürün</span>
                <b>{evidence.sourceProductName}</b>
              </div>
            )}
            {evidence.variantPriceInferred && (
              <div>
                <DatabaseZap size={15} />
                <span>Kardeş varyant fiyatı kullanıldı</span>
                <b>Aynı aile ve ölçü, farklı koku / aroma</b>
              </div>
            )}
          </div>
        </section>
        {suggestion.status === "PENDING" && (
          <section className="suggestion-decision">
            <Field
              label="Ret notu"
              hint="Yanlış eşleşmeyi kısaca tarif edebilirsiniz"
            >
              <input
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Örn. gramaj farklı"
              />
            </Field>
            <div>
              <Button
                variant="danger"
                icon={X}
                disabled={busy}
                onClick={reject}
              >
                Reddet
              </Button>
              <Button icon={Check} disabled={busy} onClick={approve}>
                Öneriyi onayla
              </Button>
            </div>
          </section>
        )}
        {suggestion.status === "APPROVED" && (
          <section className="suggestion-decision">
            <div>
              <strong>Onaylandı, henüz mappinge uygulanmadı</strong>
              <p className="muted-note">
                Bu adım gerçek ürün maliyet mappingini değiştirir ve maliyet
                hesabını yeniden çalıştırır.
              </p>
            </div>
            <Button
              icon={Play}
              disabled={busy}
              onClick={() => onPreviewApply(suggestion.id)}
            >
              Mappinge uygulama önizlemesi
            </Button>
          </section>
        )}
      </div>
    </Drawer>
  );
}

function BulkApplyModal({ preview, busy, onClose, onApply }) {
  if (!preview) return null;
  return (
    <Modal open onClose={onClose} title="Onaylı mappingleri uygula">
      <div className="modal-body bulk-preview">
        <div className="metric-row">
          <div>
            <span>Ürün</span>
            <b>{preview.productCount}</b>
          </div>
          <div>
            <span>Mapping satırı</span>
            <b>{preview.mappingCount}</b>
          </div>
          <div>
            <span>File fiyat güncellemesi</span>
            <b>{preview.priceUpdateCount}</b>
          </div>
        </div>
        <p className="muted-note">
          Uygulama sırasında ürünün hâlâ mapping eksik olduğu ve tüm maliyet
          kalemlerinin geçerli olduğu yeniden kontrol edilir.
        </p>
        <div className="bulk-preview-list">
          {preview.suggestions.map((suggestion) => (
            <div key={suggestion.id}>
              <strong>{suggestion.barcode}</strong>
              <span>{suggestionSummary(suggestion)}</span>
            </div>
          ))}
        </div>
      </div>
      <footer className="modal-actions">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Vazgeç
        </Button>
        <Button icon={Play} disabled={busy} onClick={onApply}>
          {busy ? "Uygulanıyor" : "Mappingleri uygula"}
        </Button>
      </footer>
    </Modal>
  );
}

function parseFileImport(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(/[\t;]/).map((cell) => cell.trim());
      return {
        product_name: cells[0],
        current_price: cells[1],
        brand: cells[2] || "",
        availability: cells[3] || "AVAILABLE",
      };
    });
}

function FileMarketPool({ notify }) {
  const [result, setResult] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      const response = await get(`/api/file-market/items?${params}`);
      setResult(response.data);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [search, page]);
  useEffect(() => setPage(1), [search]);

  async function importItems() {
    setSaving(true);
    try {
      const response = await post("/api/file-market/items/bulk", {
        rows: parseFileImport(importText),
      });
      notify(
        `${response.data.processed} File ürünü işlendi; ${response.data.changed} fiyat değişikliği bulundu`,
      );
      setImportOpen(false);
      setImportText("");
      await load();
    } catch (nextError) {
      notify(nextError.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: "product_name", label: "File ürünü", width: 330 },
    { key: "brand", label: "Marka" },
    {
      key: "current_price",
      label: "Güncel fiyat",
      render: (row) => money(row.current_price),
    },
    {
      key: "previous_price",
      label: "Önceki fiyat",
      render: (row) => (row.previous_price ? money(row.previous_price) : "-"),
    },
    {
      key: "price_change",
      label: "Değişim",
      render: (row) =>
        row.previous_price
          ? money(Number(row.current_price) - Number(row.previous_price))
          : "-",
    },
    {
      key: "size",
      label: "Birim",
      render: (row) => `${row.size_value || "-"} ${row.size_unit || ""}`,
    },
    {
      key: "cost_item_code",
      label: "Bağlı maliyet kalemi",
      render: (row) => row.cost_item_code || "Henüz bağlı değil",
    },
    {
      key: "last_seen_at",
      label: "Son kontrol",
      render: (row) => date(row.last_seen_at),
    },
    {
      key: "stale",
      label: "Durum",
      render: (row) => (
        <Badge tone={row.stale ? "warning" : "success"}>
          {row.stale ? "Güncelliğini kontrol et" : "Güncel"}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <div className="mapping-toolbar">
        <div className="filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="File ürün veya marka ara"
          />
        </div>
        <div className="mapping-toolbar-actions">
          <Button icon={FileUp} onClick={() => setImportOpen(true)}>
            File fiyatı içe aktar
          </Button>
          <IconButton icon={RefreshCw} label="Yenile" onClick={load} />
        </div>
      </div>
      <div className="info-banner">
        <DatabaseZap />
        <div>
          <strong>Fiyat havuzu geçmişi silmez</strong>
          <p>
            Aynı File ürünü yeniden geldiğinde güncel ve önceki fiyat birlikte
            tutulur; mapping onayında en son gözlem kullanılır.
          </p>
        </div>
      </div>
      {loading && !result ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={load} />
      ) : result?.items.length ? (
        <div className="panel table-panel">
          <DataTable
            columns={columns}
            rows={result.items}
            columnVisibilityKey="file-market-price-pool"
          />
          <Pagination
            page={result.page}
            total={result.total}
            limit={result.limit}
            onChange={setPage}
          />
        </div>
      ) : (
        <Empty label="File fiyat havuzu henüz boş" />
      )}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="File fiyatlarını içe aktar"
      >
        <div className="modal-body">
          <Field
            label="File ürün adı; fiyat; marka; durum"
            hint="Her satırı tab veya noktalı virgülle ayırın. Marka ve durum isteğe bağlıdır."
          >
            <textarea
              rows="14"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder="Actisoft Menekşe Bahçesi Konsantre 1500 ml;112;Actisoft;AVAILABLE"
            />
          </Field>
        </div>
        <footer className="modal-actions">
          <Button variant="secondary" onClick={() => setImportOpen(false)}>
            Vazgeç
          </Button>
          <Button
            icon={FileUp}
            disabled={saving || !importText.trim()}
            onClick={importItems}
          >
            {saving ? "İşleniyor" : "Fiyatları içe aktar"}
          </Button>
        </footer>
      </Modal>
    </>
  );
}
