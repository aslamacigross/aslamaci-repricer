import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  DatabaseZap,
  Eye,
  FileUp,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { get, patch, post } from "../lib/api";
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

const supplierDefinitions = {
  FILE_MARKET: { label: "File Market", shortLabel: "File", liveSync: true },
  BIZIM_MARKET: {
    label: "Bizim Toptan",
    shortLabel: "Bizim",
    liveSync: true,
  },
  BIM: { label: "BİM", shortLabel: "BİM", liveSync: true },
  OTHER: {
    label: "Diğer maliyet havuzu",
    shortLabel: "Diğer",
    liveSync: false,
  },
};

function supplierDefinition(code) {
  return (
    supplierDefinitions[code] || {
      label: code || "Tedarikçi",
      shortLabel: code || "Tedarikçi",
      liveSync: false,
    }
  );
}

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

function formatMappingError(error) {
  const details = Array.isArray(error.details) ? error.details : [];
  if (!details.length)
    return error.code ? `${error.message} (${error.code})` : error.message;
  const readable = details
    .slice(0, 4)
    .map((detail) => `${detail.code}${detail.value ? `: ${detail.value}` : ""}`)
    .join(", ");
  return `${error.message} (${readable})`;
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

function priceTiers(row) {
  return Array.isArray(row?.price_tiers)
    ? row.price_tiers
    : Array.isArray(row?.supplier_price_tiers)
      ? row.supplier_price_tiers
      : [];
}

function priceTierSummary(row) {
  const tiers = priceTiers(row);
  if (!tiers.length) return "-";
  return tiers
    .map(
      (tier) =>
        `${Number(tier.min_quantity).toLocaleString("tr-TR")}+ ${money(tier.unit_price)}`,
    )
    .join(", ");
}

function parseLocaleDecimal(value) {
  const normalized = String(value || "")
    .replace(/\s/g, "")
    .replace(/₺|TL|TRY/gi, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  return Number(normalized);
}

function diagnosticRegenerateMessage(barcode, data = {}) {
  if (data.created)
    return {
      text: `${barcode} için ${data.created} öneri üretildi`,
      tone: "success",
    };
  if (data.reason === "APPROVED_EXISTS")
    return {
      text: `${barcode} için onaylı öneri zaten var; Onaylananlar filtresinden mappinge uygulayabilirsiniz`,
      tone: "warning",
    };
  if (data.reason === "PENDING_EXISTS")
    return {
      text: `${barcode} için bekleyen öneri zaten var; Bekleyenler filtresinden inceleyebilirsiniz`,
      tone: "warning",
    };
  if (data.reason === "REJECTED_PATTERN")
    return {
      text: `${barcode} için benzer öneri daha önce reddedilmiş; manuel kuyruğa alabilir veya ret notunu DOĞRU: formatıyla güncelleyebilirsiniz`,
      tone: "warning",
    };
  return {
    text: `${barcode} için yeni öneri bulunamadı`,
    tone: "warning",
  };
}

export default function MappingSuggestions({ view, notify }) {
  if (view === "file")
    return <SupplierPricePool supplierCode="FILE_MARKET" notify={notify} />;
  if (view === "bizim")
    return <SupplierPricePool supplierCode="BIZIM_MARKET" notify={notify} />;
  if (view === "bim")
    return <SupplierPricePool supplierCode="BIM" notify={notify} />;
  if (view === "other")
    return <SupplierPricePool supplierCode="OTHER" notify={notify} />;
  if (view === "learning") return <MappingLearningHistory />;
  if (view === "diagnostics") return <MappingDiagnostics notify={notify} />;
  if (view === "manual-costs") return <ManualCostQueue notify={notify} />;
  return <SuggestionQueue notify={notify} />;
}

function ManualCostQueue({ notify }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      const response = await get(`/api/manual-cost-queue?${params}`);
      setResult(response.data);
    } catch (nextError) {
      setError(nextError);
      notify?.(nextError.message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [search, page]);
  useEffect(() => setPage(1), [search]);

  const columns = [
    { key: "barcode", label: "Barkod" },
    { key: "product_name", label: "Trendyol ürünü", width: 320 },
    { key: "brand", label: "Marka" },
    { key: "category_name", label: "Kategori" },
    { key: "data_status", label: "Veri durumu", badge: true },
    { key: "mapping_count", label: "Mapping" },
    { key: "reason", label: "Ret notu", width: 360 },
    {
      key: "created_at",
      label: "Not tarihi",
      render: (row) => date(row.created_at),
    },
    {
      key: "ops",
      label: "İşlem",
      sortable: false,
      exportable: false,
      render: (row) => (
        <IconButton
          icon={Check}
          label="Manuel maliyet gir"
          onClick={() => setEditing(row)}
        />
      ),
    },
  ];

  if (loading && !result) return <Loading />;
  if (error) return <ErrorState error={error} retry={load} />;

  return (
    <>
      <div className="mapping-toolbar">
        <div className="filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Barkod, ürün veya ret notu ara"
          />
        </div>
        <div className="mapping-toolbar-actions">
          <IconButton icon={RefreshCw} label="Yenile" onClick={load} />
        </div>
      </div>
      <div className="info-banner">
        <DatabaseZap />
        <div>
          <strong>Manuel maliyet bekleyenler</strong>
          <p>
            Ret notunda uygulamada bulunmadığı veya manuel giriş yapılacağı
            belirtilen ürünler burada toplanır. Tek form maliyet kalemini ve
            mappingi birlikte oluşturur.
          </p>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={result?.items || []}
        columnVisibilityKey="manual-cost-queue"
        exportFileName="manuel-maliyet-bekleyenler"
        onRowClick={setEditing}
      />
      <Pagination
        page={result?.page || page}
        total={result?.total || 0}
        limit={result?.limit || 50}
        onChange={setPage}
      />
      <ManualCostDrawer
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
        notify={notify}
      />
    </>
  );
}

function ManualCostDrawer({ item, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    item_name: "",
    unit_cost: "",
    unit_desi: "",
    quantity: 1,
    item_code: "",
    note: "Manuel maliyet girişi",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setForm({
      item_name: item.product_name || "",
      unit_cost: "",
      unit_desi: "",
      quantity: 1,
      item_code: "",
      note: item.reason || "Manuel maliyet girişi",
    });
  }, [item]);

  function set(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await post(`/api/manual-cost-queue/${item.barcode}/apply`, {
        ...form,
        unit_cost: Number(form.unit_cost),
        unit_desi: Number(form.unit_desi),
        quantity: Number(form.quantity),
      });
      notify?.("Manuel maliyet ve mapping oluşturuldu");
      await onSaved();
    } catch (nextError) {
      notify?.(nextError.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={Boolean(item)}
      onClose={onClose}
      title={item ? `${item.barcode} manuel maliyet` : "Manuel maliyet"}
      wide
    >
      {item && (
        <div className="form-grid">
          <div className="detail-hero">
            <ProductImage product={item} />
            <div>
              <strong>{item.product_name}</strong>
              <small>{item.reason}</small>
            </div>
          </div>
          <Field label="Maliyet kalemi adı">
            <input
              value={form.item_name}
              onChange={(event) => set("item_name", event.target.value)}
            />
          </Field>
          <Field label="Birim maliyet">
            <input
              type="number"
              step="0.01"
              value={form.unit_cost}
              onChange={(event) => set("unit_cost", event.target.value)}
            />
          </Field>
          <Field label="Birim desi">
            <input
              type="number"
              step="0.0001"
              value={form.unit_desi}
              onChange={(event) => set("unit_desi", event.target.value)}
            />
          </Field>
          <Field label="Mapping adedi">
            <input
              type="number"
              step="0.0001"
              value={form.quantity}
              onChange={(event) => set("quantity", event.target.value)}
            />
          </Field>
          <Field label="Cost code (boş kalırsa otomatik)">
            <input
              value={form.item_code}
              onChange={(event) => set("item_code", event.target.value)}
              placeholder="Otomatik üret"
            />
          </Field>
          <Field label="Not">
            <textarea
              rows={3}
              value={form.note}
              onChange={(event) => set("note", event.target.value)}
            />
          </Field>
          <div className="drawer-actions">
            <Button variant="secondary" onClick={onClose}>
              Vazgeç
            </Button>
            <Button icon={Check} disabled={saving} onClick={save}>
              {saving ? "Kaydediliyor" : "Maliyeti oluştur"}
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function diagnosisTone(code) {
  if (code === "SUGGESTION_AVAILABLE" || code === "LOW_CONFIDENCE_AVAILABLE")
    return "success";
  if (code === "REJECTED_PATTERN" || code === "LOW_SCORE") return "warning";
  if (
    code === "NO_FILE_CANDIDATE" ||
    code === "FILE_POOL_EMPTY" ||
    code === "NO_SUPPLIER_CANDIDATE" ||
    code === "SUPPLIER_POOL_EMPTY"
  )
    return "danger";
  return "neutral";
}

function MappingDiagnostics({ notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [busyBarcode, setBusyBarcode] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await get(
        "/api/mapping-suggestions/diagnostics?limit=1000",
      );
      setData(response.data);
    } catch (nextError) {
      setError(nextError);
      notify?.(nextError.message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data?.items || [];
    return (data?.items || []).filter((row) =>
      [
        row.barcode,
        row.product_name,
        row.brand,
        row.diagnosis_label,
        row.best_supplier_product_name || row.best_file_product_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [data, search]);

  async function regenerate(row) {
    setBusyBarcode(row.barcode);
    try {
      const response = await post(
        `/api/mapping-suggestions/diagnostics/${encodeURIComponent(row.barcode)}/regenerate`,
        {},
      );
      const message = diagnosticRegenerateMessage(row.barcode, response.data);
      notify?.(message.text, message.tone);
      await load();
    } catch (nextError) {
      notify?.(nextError.message, "error");
    } finally {
      setBusyBarcode(null);
    }
  }

  async function moveToManual(row) {
    setBusyBarcode(row.barcode);
    try {
      await post(
        `/api/mapping-suggestions/diagnostics/${encodeURIComponent(row.barcode)}/manual-cost`,
        {
          reason: `Teşhis ekranından manuel maliyet kuyruğuna alındı: ${
            row.diagnosis_label || row.diagnosis
          }`,
        },
      );
      notify?.(`${row.barcode} manuel maliyet kuyruğuna alındı`, "success");
      await load();
    } catch (nextError) {
      notify?.(nextError.message, "error");
    } finally {
      setBusyBarcode(null);
    }
  }

  const columns = [
    { key: "barcode", label: "Barkod" },
    { key: "product_name", label: "Trendyol ürünü", width: 320 },
    { key: "brand", label: "Marka" },
    {
      key: "diagnosis_label",
      label: "Teşhis",
      render: (row) => (
        <Badge tone={diagnosisTone(row.diagnosis)}>
          {row.diagnosis_label || row.diagnosis}
        </Badge>
      ),
    },
    {
      key: "best_supplier_label",
      label: "Tedarikçi",
      render: (row) => row.best_supplier_label || "-",
    },
    {
      key: "best_supplier_product_name",
      label: "En yakın tedarikçi ürünü",
      width: 300,
      render: (row) =>
        row.best_supplier_product_name || row.best_file_product_name || "-",
    },
    {
      key: "best_file_price",
      label: "Tedarikçi fiyatı",
      render: (row) => (row.best_file_price ? money(row.best_file_price) : "-"),
    },
    {
      key: "best_file_score",
      label: "Eşleşme skoru",
      render: (row) =>
        row.best_file_score ? percent(Number(row.best_file_score) * 100) : "-",
    },
    {
      key: "confidence",
      label: "Öneri güveni",
      render: (row) =>
        row.confidence ? percent(Number(row.confidence) * 100) : "-",
    },
    { key: "data_status", label: "Veri durumu", badge: true },
    {
      key: "ops",
      label: "İşlem",
      sortable: false,
      exportable: false,
      render: (row) => {
        const canRegenerate = [
          "SUGGESTION_AVAILABLE",
          "LOW_CONFIDENCE_AVAILABLE",
          "REJECTED_PATTERN",
          "LOW_SCORE",
        ].includes(row.diagnosis);
        const busy = busyBarcode === row.barcode;
        return (
          <div
            className="row-actions"
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              variant="secondary"
              icon={Sparkles}
              disabled={busy || !canRegenerate}
              onClick={() => regenerate(row)}
            >
              Öner
            </Button>
            <Button
              variant="ghost"
              icon={FileUp}
              disabled={busy}
              onClick={() => moveToManual(row)}
            >
              Manuel
            </Button>
          </div>
        );
      },
    },
  ];

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} retry={load} />;

  return (
    <>
      <div className="mapping-toolbar">
        <div className="filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Barkod, ürün, teşhis veya tedarikçi adayı ara"
          />
        </div>
        <div className="mapping-toolbar-actions">
          <IconButton icon={RefreshCw} label="Yenile" onClick={load} />
        </div>
      </div>
      <div className="info-banner">
        <DatabaseZap />
        <div>
          <strong>Öneri üretilememe nedenleri</strong>
          <p>
            Bu ekran mapping hedeflerini tedarikçi fiyat havuzları ve öğrenme
            geçmişiyle karşılaştırır. Düşük güvenli adaylar onay/retle öğrenme
            verisine dönüşebilir.
          </p>
        </div>
      </div>
      <section className="diagnostic-summary">
        {Object.entries(data?.summary || {}).map(([key, value]) => (
          <article key={key}>
            <span>{key}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <DataTable
        columns={columns}
        rows={rows}
        columnVisibilityKey="mapping-diagnostics"
        exportFileName="mapping-teshis"
      />
    </>
  );
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
  const [supplierCode, setSupplierCode] = useState("");
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
      if (supplierCode) params.set("supplierCode", supplierCode);
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
  }, [search, status, confidence, supplierCode, page]);

  useEffect(() => setPage(1), [search, status, confidence, supplierCode]);

  async function generate() {
    setGenerating(true);
    try {
      const response = await post("/api/mapping-suggestions/generate", {
        limit: 1000,
      });
      const data = response.data;
      notify(
        `${data.created} yeni öneri üretildi; ${data.processed} ürün tarandı, ${data.scoped} ürün tedarikçi kapsamındaydı, ${data.withoutCandidate || 0} üründe uygun aday kalmadı, ${data.withoutFileSupport || 0} üründe fiyat desteği yok`,
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
      notify(formatMappingError(nextError), "error");
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
        key: "supplier_product_name",
        label: "Tedarikçi ürünü",
        render: (row) => (
          <div className="confidence-cell">
            <span>
              {row.supplier_product_name ||
                row.file_product_name ||
                row.items.find(
                  (item) =>
                    item.supplier_product_name || item.file_product_name,
                )?.supplier_product_name ||
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
        key: "supplier_current_price",
        label: "Tedarikçi fiyatı",
        render: (row) => {
          const price =
            row.supplier_current_price ||
            row.file_current_price ||
            row.items.find(
              (item) => item.supplier_current_price || item.file_current_price,
            )?.supplier_current_price ||
            row.items.find((item) => item.file_current_price)
              ?.file_current_price;
          return price ? money(price) : "-";
        },
      },
      {
        key: "supplier_code",
        label: "Kaynak",
        render: (row) => supplierDefinition(row.supplier_code).shortLabel,
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
              ? "Eski mapping + tedarikçi"
              : row.source_type === "MANUAL_HISTORY"
                ? "Eski mapping"
                : row.source_type === "FILE_MARKET"
                  ? "Tedarikçi + maliyet kataloğu"
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
          <select
            value={supplierCode}
            onChange={(event) => setSupplierCode(event.target.value)}
          >
            <option value="">Tüm tedarikçiler</option>
            <option value="FILE_MARKET">File Market</option>
            <option value="BIZIM_MARKET">Bizim Toptan</option>
            <option value="BIM">BİM</option>
            <option value="OTHER">Diğer maliyet havuzu</option>
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
          notify("Öneri onaylandı; sıradaki öneriye geçebilirsiniz");
          await load();
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
        supplier_code: item.supplier_code || suggestion.supplier_code,
        suggested_unit_cost: Number(
          item.suggested_unit_cost ||
            item.supplier_effective_unit_price ||
            item.supplier_current_price ||
            item.file_current_price ||
            0,
        ),
        selected_price_tier: item.selected_price_tier || null,
        unit_desi: Number(item.unit_desi || 0),
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
      notify(formatMappingError(error), "error");
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

  async function cancelApproval() {
    setBusy(true);
    try {
      await post(`/api/mapping-suggestions/${suggestion.id}/cancel-approval`, {
        reason: "Yanlışlıkla onaylandı",
      });
      notify("Öneri onayı iptal edildi");
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
            <span>Fiyat kaynağı</span>
            <b>{supplierDefinition(suggestion.supplier_code).label}</b>
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
                        : `${supplierDefinition(item.supplier_code || suggestion.supplier_code).shortLabel} fiyatı bulundu`
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
                  <Field
                    label="Birim desi"
                    hint={
                      item.desi_confidence === "LOW"
                        ? "Gramaj bulunamadı; onaydan önce kontrol edin"
                        : "Gramaj / hacimden hesaplandı"
                    }
                  >
                    <input
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      value={form.items[index].unit_desi}
                      disabled={suggestion.status !== "PENDING"}
                      onChange={(event) =>
                        updateItem(
                          index,
                          "unit_desi",
                          Number(event.target.value),
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="compact-kv">
                  <span>Mevcut birim maliyet</span>
                  <b>{money(item.unit_cost || item.current_unit_cost)}</b>
                  <span>Tedarikçi ürünü</span>
                  <b>
                    {item.supplier_product_name ||
                      item.file_product_name ||
                      "Eşleşme yok"}
                  </b>
                  <span>Güncel tedarikçi fiyatı</span>
                  <b>
                    {item.supplier_current_price || item.file_current_price
                      ? money(
                          item.supplier_current_price ||
                            item.file_current_price,
                        )
                      : "-"}
                  </b>
                  <span>Kullanılan birim fiyat</span>
                  <b>
                    {item.suggested_unit_cost
                      ? money(item.suggested_unit_cost)
                      : "-"}
                  </b>
                  <span>Çoklu fiyat kademesi</span>
                  <b>
                    {item.selected_price_tier
                      ? `${Number(item.selected_price_tier.min_quantity).toLocaleString("tr-TR")}+ adet: ${money(item.selected_price_tier.unit_price)}`
                      : priceTierSummary(item)}
                  </b>
                  <span>Desi güveni</span>
                  <b>
                    {item.desi_confidence === "HIGH"
                      ? "Gramajdan hesaplandı"
                      : "Kontrol gerekli"}
                  </b>
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
              Tedarikçi fiyatını ilgili maliyet kalemine uygula
              <small>
                Uygulama anındaki güncel tedarikçi fiyatı kullanılır ve eski
                fiyat geçmişte korunur.
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
            <Button
              variant="danger"
              icon={X}
              disabled={busy}
              onClick={cancelApproval}
            >
              Onayı iptal et
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
            <span>Tedarikçi fiyat güncellemesi</span>
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

function parseSupplierImport(text) {
  const input = String(text || "").trim();
  if (input.startsWith("[")) {
    const rows = JSON.parse(input);
    if (!Array.isArray(rows)) throw new Error("JSON ürün listesi geçersiz");
    return rows;
  }
  return input
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

function SupplierPricePool({ supplierCode, notify }) {
  const definition = supplierDefinition(supplierCode);
  const supportsBulkPrices = supplierCode === "BIZIM_MARKET";
  const [result, setResult] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncingLive, setSyncingLive] = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      const response = await get(
        `/api/supplier-price-pools/${supplierCode}/items?${params}`,
      );
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
  }, [search, page, supplierCode]);
  useEffect(() => setPage(1), [search]);

  async function importItems() {
    setSaving(true);
    try {
      const response = await post(
        `/api/supplier-price-pools/${supplierCode}/items/bulk`,
        { rows: parseSupplierImport(importText) },
      );
      notify(
        `${response.data.processed} ${definition.shortLabel} ürünü işlendi; ${response.data.changed} fiyat değişikliği bulundu`,
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

  async function syncLiveItems() {
    setSyncingLive(true);
    try {
      const response = await post(
        `/api/supplier-price-pools/${supplierCode}/items/sync-live`,
        {},
      );
      const meta = response.data.metadata || {};
      notify(
        `${response.data.processed} ${definition.shortLabel} ürünü işlendi; ${response.data.created} yeni, ${response.data.changed} fiyat değişikliği. ${meta.productsScanned || meta.targetProducts || 0} ürün tarandı.`,
      );
      await load();
    } catch (nextError) {
      notify(nextError.message, "error");
    } finally {
      setSyncingLive(false);
    }
  }

  const columns = [
    {
      key: "product_name",
      label: `${definition.shortLabel} ürünü`,
      width: 330,
    },
    { key: "brand", label: "Marka" },
    {
      key: "current_price",
      label: "Güncel fiyat",
      render: (row) => money(row.current_price),
    },
    ...(supportsBulkPrices
      ? [
          {
            key: "price_tiers",
            label: "Çoklu fiyat",
            render: (row) => {
              const tiers = priceTiers(row);
              return (
                <button
                  type="button"
                  className="supplier-tier-edit-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditing(row);
                  }}
                >
                  <span>{tiers.length ? priceTierSummary(row) : "Ekle"}</span>
                  <Pencil size={14} />
                </button>
              );
            },
          },
        ]
      : []),
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
      key: "estimated_unit_desi",
      label: "Tahmini desi",
      render: (row) => row.estimated_unit_desi || "-",
    },
    {
      key: "desi_confidence",
      label: "Desi güveni",
      render: (row) => (
        <Badge tone={row.desi_confidence === "HIGH" ? "success" : "warning"}>
          {row.desi_confidence === "HIGH" ? "Gramajdan" : "Kontrol gerekli"}
        </Badge>
      ),
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
    ...(supportsBulkPrices
      ? [
          {
            key: "ops",
            label: "İşlem",
            sortable: false,
            exportable: false,
            render: (row) => (
              <IconButton
                icon={Pencil}
                label="Fiyat kademelerini düzenle"
                onClick={() => setEditing(row)}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <div className="mapping-toolbar">
        <div className="filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={`${definition.shortLabel} ürün veya marka ara`}
          />
        </div>
        <div className="mapping-toolbar-actions">
          {definition.liveSync && (
            <Button
              icon={RefreshCw}
              disabled={syncingLive}
              onClick={syncLiveItems}
            >
              {syncingLive
                ? `${definition.shortLabel} taranıyor`
                : `Canlı ${definition.shortLabel}'den yenile`}
            </Button>
          )}
          <Button icon={FileUp} onClick={() => setImportOpen(true)}>
            {definition.shortLabel} fiyatı içe aktar
          </Button>
          <IconButton icon={RefreshCw} label="Yenile" onClick={load} />
        </div>
      </div>
      <div className="info-banner">
        <DatabaseZap />
        <div>
          <strong>Fiyat havuzu geçmişi silmez</strong>
          <p>
            Aynı {definition.shortLabel} ürünü yeniden geldiğinde güncel ve
            önceki fiyat birlikte tutulur; mapping onayında en son gözlem
            kullanılır.
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
            columnVisibilityKey={`supplier-price-pool-${supplierCode}`}
            onRowClick={supportsBulkPrices ? setEditing : undefined}
          />
          <Pagination
            page={result.page}
            total={result.total}
            limit={result.limit}
            onChange={setPage}
          />
        </div>
      ) : (
        <Empty label={`${definition.label} fiyat havuzu henüz boş`} />
      )}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title={`${definition.label} fiyatlarını içe aktar`}
      >
        <div className="modal-body">
          <Field
            label={`${definition.shortLabel} ürün adı; fiyat; marka; durum`}
            hint="Satırları tab veya noktalı virgülle ayırın; tam kataloglar için JSON dizi de yapıştırabilirsiniz."
          >
            <textarea
              rows="14"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={`${definition.shortLabel} ürünü;112;Marka;AVAILABLE`}
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
      {supportsBulkPrices && (
        <SupplierPriceDrawer
          item={editing}
          supplierCode={supplierCode}
          definition={definition}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
          notify={notify}
        />
      )}
    </>
  );
}

function SupplierPriceDrawer({
  item,
  supplierCode,
  definition,
  onClose,
  onSaved,
  notify,
}) {
  const [form, setForm] = useState({
    current_price: "",
    price_tiers: [],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setForm({
      current_price: item.current_price || "",
      price_tiers: priceTiers(item).map((tier) => ({
        min_quantity: Number(tier.min_quantity),
        unit_price: Number(tier.unit_price),
        label: tier.label || "",
      })),
    });
  }, [item]);

  if (!item) return null;

  function updateTier(index, field, value) {
    setForm((current) => ({
      ...current,
      price_tiers: current.price_tiers.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, [field]: value } : tier,
      ),
    }));
  }

  function removeTier(index) {
    setForm((current) => ({
      ...current,
      price_tiers: current.price_tiers.filter(
        (_, tierIndex) => tierIndex !== index,
      ),
    }));
  }

  function addTier() {
    setForm((current) => ({
      ...current,
      price_tiers: [
        ...current.price_tiers,
        { min_quantity: 6, unit_price: "", label: "6+ adet" },
      ],
    }));
  }

  async function save() {
    setSaving(true);
    try {
      await patch(
        `/api/supplier-price-pools/${supplierCode}/items/${item.id}`,
        {
          current_price: parseLocaleDecimal(form.current_price),
          price_tiers: form.price_tiers
            .map((tier) => ({
              min_quantity: parseLocaleDecimal(tier.min_quantity),
              unit_price: parseLocaleDecimal(tier.unit_price),
              label: tier.label,
            }))
            .filter(
              (tier) =>
                Number.isFinite(tier.min_quantity) &&
                tier.min_quantity > 1 &&
                Number.isFinite(tier.unit_price) &&
                tier.unit_price > 0,
            ),
        },
      );
      notify?.(`${definition.shortLabel} fiyat kademesi kaydedildi`);
      await onSaved();
    } catch (error) {
      notify?.(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={`${definition.shortLabel} fiyat kademesi`}
    >
      <div className="form-grid supplier-tier-drawer">
        <div className="detail-hero">
          <div>
            <strong>{item.product_name}</strong>
            <small>{item.brand || definition.label}</small>
          </div>
          <Badge tone={priceTiers(item).length ? "info" : "neutral"}>
            {priceTiers(item).length ? "Çoklu fiyat var" : "Tek fiyat"}
          </Badge>
        </div>
        <Field label="Normal birim fiyat">
          <input
            inputMode="decimal"
            value={form.current_price}
            placeholder="16,90"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                current_price: event.target.value,
              }))
            }
          />
        </Field>
        <section>
          <h3>Çoklu alım fiyatları</h3>
          <div className="supplier-tier-list">
            {form.price_tiers.map((tier, index) => (
              <div key={`${index}:${tier.min_quantity}`}>
                <Field label="Min adet">
                  <input
                    inputMode="numeric"
                    value={tier.min_quantity}
                    placeholder="32"
                    onChange={(event) =>
                      updateTier(index, "min_quantity", event.target.value)
                    }
                  />
                </Field>
                <Field label="Birim fiyat">
                  <input
                    inputMode="decimal"
                    value={tier.unit_price}
                    placeholder="15,90"
                    onChange={(event) =>
                      updateTier(index, "unit_price", event.target.value)
                    }
                  />
                </Field>
                <Field label="Etiket">
                  <input
                    value={tier.label}
                    onChange={(event) =>
                      updateTier(index, "label", event.target.value)
                    }
                    placeholder={`${tier.min_quantity || "x"}+ adet`}
                  />
                </Field>
                <Button
                  variant="ghost"
                  icon={X}
                  onClick={() => removeTier(index)}
                >
                  Sil
                </Button>
              </div>
            ))}
          </div>
          <Button variant="secondary" icon={Sparkles} onClick={addTier}>
            Kademe ekle
          </Button>
        </section>
        <div className="drawer-actions">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button icon={Check} disabled={saving} onClick={save}>
            {saving ? "Kaydediliyor" : "Kaydet"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
