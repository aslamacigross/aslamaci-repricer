import React, { useEffect, useMemo, useState } from "react";
import {
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  Calculator,
  Copy,
  Eye,
  TriangleAlert,
  GitBranch,
  BrainCircuit,
  Sparkles,
  Store,
  SearchCheck,
  PencilLine,
  Truck,
  CheckCircle2,
} from "lucide-react";
import { get, post, patch, del } from "../lib/api";
import DataTable, { money, percent, date } from "../components/DataTable";
import {
  PageHeader,
  SearchInput,
  IconButton,
  Button,
  Loading,
  ErrorState,
  Modal,
  Field,
  Badge,
  toneFor,
  Confirm,
  Pagination,
} from "../components/ui";
import MappingSuggestions from "./MappingSuggestions";
const titles = {
  costs: ["Maliyet Kalemleri", "Birim maliyet ve desi bilgisini yönetin"],
  mappings: [
    "Ürün Mapping",
    "Barkodların hangi maliyet kalemlerinden oluştuğunu yönetin",
  ],
  commissions: [
    "Komisyonlar",
    "Pazaryeri API kaynaklı kategori komisyon raporu",
  ],
  shipping: [
    "Kargo & Ambalaj",
    "KDV hariç tarifeler, sepet baremleri ve ambalaj kuralları",
  ],
};

function parseBulkRows(text, mode) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(/[\t;]/).map((cell) => cell.trim());
      if (mode === "commissions")
        return {
          category_id: cells[0],
          category_name: cells[1],
          commission_rate: Number(cells[2]),
          note: cells[3] || "",
        };
      if (mode === "costs")
        return {
          item_code: cells[0],
          item_name: cells[1],
          unit_cost: Number(cells[2]),
          unit_desi: Number(cells[3] || 0),
          unit: cells[4] || "adet",
          note: cells[5] || "",
        };
      return {
        barcode: cells[0],
        cost_item_code: cells[1],
        quantity: Number(cells[2]),
      };
    });
}

function formatCostError(error) {
  const details = Array.isArray(error.details) ? error.details : [];
  if (!details.length)
    return error.code ? `${error.message} (${error.code})` : error.message;
  const readable = details
    .slice(0, 5)
    .map((detail) => {
      const row = detail.row ? `${detail.row}. satır ` : "";
      const value = detail.value || detail.key || "";
      return `${row}${detail.code}${value ? `: ${value}` : ""}`;
    })
    .join(", ");
  const suffix = details.length > 5 ? ` +${details.length - 5} hata` : "";
  return `${error.message} (${readable}${suffix})`;
}

function normalizeMappingForm(form) {
  const rawQuantity = form.quantity;
  const quantity =
    rawQuantity === undefined || rawQuantity === null || rawQuantity === ""
      ? 1
      : Number(rawQuantity);
  return {
    ...form,
    barcode: String(form.barcode || "").trim(),
    cost_item_code: String(form.cost_item_code || "").trim(),
    quantity,
  };
}

export default function Costs({ mode, notify, marketplace = "TRENDYOL" }) {
  const [items, setItems] = useState(null),
    [search, setSearch] = useState(""),
    [error, setError] = useState(null),
    [editing, setEditing] = useState(null),
    [costView, setCostView] = useState("items"),
    [mappingView, setMappingView] = useState("manual"),
    [shippingQuery, setShippingQuery] = useState({
      marketplace,
      page: 1,
      limit: 50,
      carrier: "",
      desi: "",
    });
  async function load() {
    setError(null);
    try {
      if (mode === "shipping") {
        const params = new URLSearchParams({
          marketplace: shippingQuery.marketplace,
          page: String(shippingQuery.page),
          limit: String(shippingQuery.limit),
        });
        if (shippingQuery.carrier) params.set("carrier", shippingQuery.carrier);
        if (shippingQuery.desi !== "")
          params.set("desi", String(shippingQuery.desi));
        setItems((await get(`/api/shipping?${params}`)).data);
      } else {
        const endpoint = mode === "costs" ? "cost-items" : mode;
        const params = new URLSearchParams();
        if (["mappings", "commissions"].includes(mode))
          params.set("marketplace", marketplace);
        setItems(
          (await get(`/api/${endpoint}${params.size ? `?${params}` : ""}`))
            .items,
        );
      }
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => {
    setItems(null);
    setEditing(null);
    setShippingQuery((current) => ({
      ...current,
      marketplace,
      page: 1,
      carrier: "",
      desi: "",
    }));
  }, [marketplace]);
  useEffect(() => {
    load();
  }, [
    mode,
    shippingQuery.marketplace,
    shippingQuery.page,
    shippingQuery.limit,
    shippingQuery.carrier,
    shippingQuery.desi,
    marketplace,
  ]);
  if (!items && !error) return <Loading />;
  const [t, d] = titles[mode];
  return (
    <>
      <PageHeader
        title={t}
        description={`${marketplace === "TRENDYOL" ? "Trendyol" : "Hepsiburada"} · ${d}`}
        actions={
          <>
            {mode !== "commissions" &&
              !(mode === "costs" && costView !== "items") &&
              !(mode === "mappings" && mappingView !== "manual") && (
                <Button
                  icon={Plus}
                  onClick={() =>
                    setEditing(
                      mode === "shipping"
                        ? { marketplace: shippingQuery.marketplace }
                        : mode === "mappings"
                          ? { marketplace }
                          : {},
                    )
                  }
                >
                  Yeni ekle
                </Button>
              )}
            <IconButton icon={RefreshCw} label="Yenile" onClick={load} />
          </>
        }
      />
      {mode === "mappings" && marketplace === "HEPSIBURADA" && (
        <div className="info-banner">
          <Sparkles />
          <div>
            <strong>Hepsiburada mapping çalışma alanı</strong>
            <p>
              Ürün sync sonrası Hepsiburada barkodları burada Trendyol'dan
              bağımsız maplenir; maliyet havuzları ortaktır, ürün reçetesi ve
              minimum fiyat pazaryerine özeldir.
            </p>
          </div>
        </div>
      )}
      {mode === "mappings" && (
        <div className="tabs page-tabs mapping-tabs">
          <button
            className={mappingView === "manual" ? "active" : ""}
            onClick={() => setMappingView("manual")}
          >
            <GitBranch /> Mevcut mappingler
          </button>
          <button
            className={mappingView === "suggestions" ? "active" : ""}
            onClick={() => setMappingView("suggestions")}
          >
            <Sparkles /> Akıllı öneriler
          </button>
          <button
            className={mappingView === "file" ? "active" : ""}
            onClick={() => setMappingView("file")}
          >
            <Store /> File fiyat havuzu
          </button>
          <button
            className={mappingView === "bizim" ? "active" : ""}
            onClick={() => setMappingView("bizim")}
          >
            <Store /> Bizim Toptan havuzu
          </button>
          <button
            className={mappingView === "bim" ? "active" : ""}
            onClick={() => setMappingView("bim")}
          >
            <Store /> BİM havuzu
          </button>
          <button
            className={mappingView === "other" ? "active" : ""}
            onClick={() => setMappingView("other")}
          >
            <Store /> Diğer maliyet havuzu
          </button>
          <button
            className={mappingView === "diagnostics" ? "active" : ""}
            onClick={() => setMappingView("diagnostics")}
          >
            <SearchCheck /> Teşhis
          </button>
          <button
            className={mappingView === "manual-costs" ? "active" : ""}
            onClick={() => setMappingView("manual-costs")}
          >
            <PencilLine /> Manuel bekleyenler
          </button>
          <button
            className={mappingView === "learning" ? "active" : ""}
            onClick={() => setMappingView("learning")}
          >
            <BrainCircuit /> Karar geçmişi
          </button>
        </div>
      )}
      {mode === "costs" && (
        <div className="tabs page-tabs mapping-tabs">
          <button
            className={costView === "items" ? "active" : ""}
            onClick={() => setCostView("items")}
          >
            <Store /> Maliyet kalemleri
          </button>
          <button
            className={costView === "review" ? "active" : ""}
            onClick={() => setCostView("review")}
          >
            <CheckCircle2 /> Kontrol zamanı
          </button>
        </div>
      )}
      {error ? (
        <ErrorState error={error} retry={load} />
      ) : mode === "mappings" && mappingView !== "manual" ? (
        <MappingSuggestions
          view={mappingView}
          notify={notify}
          marketplace={marketplace}
        />
      ) : mode === "shipping" ? (
        <Shipping
          data={items}
          notify={notify}
          reload={load}
          editing={editing}
          setEditing={setEditing}
          query={shippingQuery}
          setQuery={setShippingQuery}
        />
      ) : mode === "costs" && costView === "review" ? (
        <ManualCostReview notify={notify} />
      ) : (
        <ResourceTable
          mode={mode}
          items={items}
          search={search}
          setSearch={setSearch}
          editing={editing}
          setEditing={setEditing}
          notify={notify}
          reload={load}
          marketplace={marketplace}
        />
      )}
    </>
  );
}

function ManualCostReview({ notify }) {
  const [data, setData] = useState(null),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(null),
    [editing, setEditing] = useState(null);
  const limit = 50;
  async function load(nextPage = page, nextSearch = search) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit),
        search: nextSearch,
      });
      setData((await get(`/api/cost-items/manual-review?${params}`)).data);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(1, search);
  }, []);
  function updateSearch(value) {
    setSearch(value);
    setPage(1);
    load(1, value);
  }
  function changePage(nextPage) {
    setPage(nextPage);
    load(nextPage, search);
  }
  const rows = data?.items || [];
  const columns = [
    { key: "item_code", label: "Cost Code" },
    { key: "item_name", label: "Maliyet kalemi" },
    {
      key: "unit_cost",
      label: "Birim maliyet",
      render: (row) => money(row.unit_cost),
    },
    { key: "unit_desi", label: "Birim desi" },
    {
      key: "price_source",
      label: "Kaynak",
      render: (row) => row.price_source || "MANUAL",
    },
    {
      key: "supplier_candidate",
      label: "Canlı aday",
      render: (row) =>
        row.supplier_candidate ? (
          <Badge tone="info">
            {row.supplier_candidate.supplier_code === "FILE_MARKET"
              ? "File"
              : row.supplier_candidate.supplier_code === "BIZIM_MARKET"
                ? "Bizim"
                : "BİM"}
          </Badge>
        ) : (
          "-"
        ),
    },
    { key: "product_count", label: "Kullanım" },
    {
      key: "source_checked_at",
      label: "Son kontrol",
      render: (row) => date(row.source_checked_at || row.updated_at),
    },
    {
      key: "manual_review_next_due_at",
      label: "Sonraki kontrol",
      render: (row) => date(row.manual_review_next_due_at),
    },
    {
      key: "due",
      label: "Durum",
      render: (row) => (
        <Badge tone={row.due ? "warning" : "success"}>
          {row.due ? "Kontrol et" : "Güncel"}
        </Badge>
      ),
    },
  ];
  if (error) return <ErrorState error={error} retry={() => load()} />;
  return (
    <>
      <div className="info-banner">
        <CheckCircle2 />
        <div>
          <strong>Manuel maliyet hatırlatıcısı</strong>
          <p>
            Canlı File, Bizim veya BİM linki olmayan maliyetler ayda bir burada
            görünür. Fiyat değişmediyse aynı kalsın; değiştiyse yeni fiyatı
            girin, sistem minimum fiyatları yeniden hesaplar.
          </p>
        </div>
      </div>
      <div className="filters">
        <SearchInput
          value={search}
          onChange={updateSearch}
          placeholder="Cost code veya maliyet kalemi ara"
        />
        <IconButton icon={RefreshCw} label="Yenile" onClick={() => load()} />
      </div>
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="panel table-panel">
          <DataTable
            columns={columns}
            rows={rows}
            exportRows={rows}
            columnVisibilityKey="manual-cost-review"
            exportFileName="manuel-maliyet-kontrol"
            onRowClick={(row) => setEditing(row)}
          />
          <Pagination
            page={data?.page || page}
            total={data?.total || 0}
            limit={data?.limit || limit}
            onChange={changePage}
          />
        </div>
      )}
      <ManualCostReviewModal
        value={editing}
        onClose={() => setEditing(null)}
        notify={notify}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </>
  );
}

function ManualCostReviewModal({ value, onClose, notify, onSaved }) {
  const [form, setForm] = useState(value || {}),
    [saving, setSaving] = useState(false);
  useEffect(() => setForm(value || {}), [value]);
  if (!value) return null;
  const set = (key, nextValue) => setForm({ ...form, [key]: nextValue });
  async function confirmSame() {
    setSaving(true);
    try {
      await post(`/api/cost-items/manual-review/${value.id}/confirm`, {
        note: form.manual_review_note,
        intervalDays: form.manual_review_interval_days || 30,
      });
      notify("Maliyet aynı kaldı olarak işaretlendi");
      onSaved();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }
  async function updateCost() {
    setSaving(true);
    try {
      await patch(`/api/cost-items/manual-review/${value.id}`, {
        unit_cost: Number(form.unit_cost),
        unit_desi:
          form.unit_desi === "" || form.unit_desi === undefined
            ? undefined
            : Number(form.unit_desi),
        note: form.manual_review_note,
        intervalDays: form.manual_review_interval_days || 30,
      });
      notify("Maliyet güncellendi ve minimum fiyatlar yeniden hesaplandı");
      onSaved();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }
  async function linkSupplierCandidate() {
    if (!value.supplier_candidate?.id) return;
    setSaving(true);
    try {
      await post(`/api/cost-items/manual-review/${value.id}/link-supplier`, {
        supplierItemId: value.supplier_candidate.id,
        note:
          form.manual_review_note ||
          `${value.supplier_candidate.product_name} canlı havuzuna bağlandı`,
        intervalDays: form.manual_review_interval_days || 30,
      });
      notify("Maliyet kalemi canlı tedarikçi havuzuna bağlandı");
      onSaved();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }
  const sampleProducts = Array.isArray(value.sample_products)
    ? value.sample_products.filter(Boolean)
    : [];
  const supplierCandidate = value.supplier_candidate;
  return (
    <Modal open onClose={onClose} title="Manuel maliyet kontrolü">
      <div className="modal-body form-grid">
        <Field label="Cost Code">
          <input value={form.item_code || ""} disabled />
        </Field>
        <Field label="Maliyet kalemi">
          <input value={form.item_name || ""} disabled />
        </Field>
        <Field label="Birim maliyet">
          <input
            type="number"
            step="0.01"
            value={form.unit_cost || ""}
            onChange={(event) => set("unit_cost", event.target.value)}
          />
        </Field>
        <Field label="Birim desi">
          <input
            type="number"
            step="0.01"
            value={form.unit_desi ?? ""}
            onChange={(event) => set("unit_desi", event.target.value)}
          />
        </Field>
        <Field label="Kontrol aralığı (gün)">
          <input
            type="number"
            min="1"
            max="365"
            value={form.manual_review_interval_days || 30}
            onChange={(event) =>
              set("manual_review_interval_days", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Not">
          <input
            value={form.manual_review_note || ""}
            onChange={(event) => set("manual_review_note", event.target.value)}
            placeholder="Örn. tedarikçide kontrol edildi"
          />
        </Field>
      </div>
      {supplierCandidate && (
        <div className="modal-body">
          <div className="info-banner">
            <Store />
            <div>
              <strong>Canlı tedarikçi havuzunda aday bulundu</strong>
              <p>
                {supplierCandidate.product_name} ·{" "}
                {money(supplierCandidate.current_price)} ·{" "}
                {supplierCandidate.supplier_code === "FILE_MARKET"
                  ? "File Market"
                  : supplierCandidate.supplier_code === "BIZIM_MARKET"
                    ? "Bizim Toptan"
                    : "BİM"}
              </p>
            </div>
          </div>
        </div>
      )}
      <div className="modal-body resource-context">
        <section>
          <h3>Kullanıldığı ürünler ({value.product_count || 0})</h3>
          {sampleProducts.length ? (
            <div className="table-wrap compact-table">
              <table>
                <thead>
                  <tr>
                    <th>Pazaryeri</th>
                    <th>Barkod</th>
                    <th>Ürün</th>
                    <th>Adet</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleProducts.slice(0, 30).map((item) => (
                    <tr key={`${item.marketplace}:${item.barcode}`}>
                      <td>{item.marketplace}</td>
                      <td>{item.barcode}</td>
                      <td>{item.product_name || "-"}</td>
                      <td>{item.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Bu maliyet kalemi henüz aktif bir mapping içinde görünmüyor.</p>
          )}
        </section>
      </div>
      <footer className="modal-actions">
        <span />
        <Button variant="secondary" onClick={onClose}>
          Vazgeç
        </Button>
        <Button
          variant="secondary"
          icon={CheckCircle2}
          onClick={confirmSame}
          disabled={saving}
        >
          Aynı kalsın
        </Button>
        {supplierCandidate && (
          <Button
            variant="secondary"
            icon={Store}
            onClick={linkSupplierCandidate}
            disabled={saving}
          >
            Canlı havuza bağla
          </Button>
        )}
        <Button icon={Save} onClick={updateCost} disabled={saving}>
          Fiyatı güncelle
        </Button>
      </footer>
    </Modal>
  );
}
function ResourceTable({
  mode,
  items,
  search,
  setSearch,
  editing,
  setEditing,
  notify,
  reload,
  marketplace,
}) {
  const [missingCommissions, setMissingCommissions] = useState([]),
    [page, setPage] = useState(1),
    [duplicateReport, setDuplicateReport] = useState(null),
    [scanningDuplicates, setScanningDuplicates] = useState(false);
  useEffect(() => {
    if (mode !== "commissions") {
      setMissingCommissions([]);
      return;
    }
    get(`/api/commissions/missing/categories?marketplace=${marketplace}`)
      .then((result) => setMissingCommissions(result.items || []))
      .catch(() => setMissingCommissions([]));
  }, [mode, items]);
  useEffect(() => setPage(1), [mode, search]);
  useEffect(() => {
    if (mode !== "costs") setDuplicateReport(null);
  }, [mode, marketplace]);
  async function scanDuplicateCosts() {
    setScanningDuplicates(true);
    try {
      const result = await get("/api/cost-items/duplicates");
      setDuplicateReport(result.data);
      notify(
        result.data.total
          ? `${result.data.total} şüpheli maliyet kalemi çifti bulundu`
          : "Şüpheli tekrar bulunmadı",
        result.data.total ? "warning" : "success",
      );
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setScanningDuplicates(false);
    }
  }
  const columns =
    mode === "costs"
      ? [
          { key: "item_code", label: "Cost Code" },
          { key: "item_name", label: "Maliyet kalemi" },
          {
            key: "unit_cost",
            label: "Birim maliyet",
            render: (r) => money(r.unit_cost),
          },
          { key: "unit_desi", label: "Birim desi" },
          { key: "unit", label: "Birim" },
          { key: "product_count", label: "Kullanım" },
        ]
      : mode === "mappings"
        ? [
            { key: "barcode", label: "Barkod" },
            { key: "product_name", label: "Ürün" },
            { key: "cost_item_code", label: "Cost Code" },
            { key: "item_name", label: "Maliyet kalemi" },
            { key: "quantity", label: "Adet" },
            {
              key: "line_cost",
              label: "Satır maliyeti",
              render: (r) => money(r.line_cost),
            },
            {
              key: "orphan",
              label: "Durum",
              render: (r) => (
                <Badge tone={r.orphan || r.incomplete ? "danger" : "success"}>
                  {r.orphan
                    ? "Orphan"
                    : r.incomplete
                      ? "Maliyet eksik"
                      : "Geçerli"}
                </Badge>
              ),
            },
          ]
        : [
            { key: "category_id", label: "Kategori ID" },
            { key: "category_name", label: "Kategori" },
            {
              key: "average_commission_rate",
              label: "Ortalama komisyon",
              render: (r) => percent(r.average_commission_rate),
            },
            {
              key: "min_commission_rate",
              label: "Min",
              render: (r) => percent(r.min_commission_rate),
            },
            {
              key: "max_commission_rate",
              label: "Maks",
              render: (r) => percent(r.max_commission_rate),
            },
            { key: "product_count", label: "Toplam ürün" },
            { key: "active_product_count", label: "Aktif ürün" },
            {
              key: "missing_commission_count",
              label: "Eksik",
              render: (r) => (
                <Badge
                  tone={r.missing_commission_count ? "warning" : "success"}
                >
                  {r.missing_commission_count || 0}
                </Badge>
              ),
            },
            {
              key: "last_api_check_at",
              label: "Son API kontrolü",
              render: (r) => date(r.last_api_check_at),
            },
          ];
  const filtered = useMemo(
    () =>
      items.filter((x) =>
        JSON.stringify(x).toLowerCase().includes(search.toLowerCase()),
      ),
    [items, search],
  );
  const limit = 100;
  const paged = filtered.slice((page - 1) * limit, page * limit);
  return (
    <>
      <div className="filters">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Listede ara"
        />
        {mode === "mappings" && (
          <>
            <Button
              variant="secondary"
              icon={Copy}
              onClick={() => setEditing({ clone: true })}
            >
              Mapping çoğalt
            </Button>
            <Button
              variant="secondary"
              icon={Upload}
              onClick={() => setEditing({ bulk: true })}
            >
              Toplu mapping
            </Button>
          </>
        )}
        {mode === "costs" && (
          <>
            <Button
              variant="secondary"
              icon={SearchCheck}
              onClick={scanDuplicateCosts}
              disabled={scanningDuplicates}
            >
              {scanningDuplicates ? "Taranıyor" : "Tekrarları tara"}
            </Button>
            <Button
              variant="secondary"
              icon={Upload}
              onClick={() => setEditing({ bulk: true })}
            >
              Toplu maliyet
            </Button>
          </>
        )}
      </div>
      {mode === "costs" && duplicateReport && (
        <div className="info-banner">
          <SearchCheck />
          <div>
            <strong>
              {duplicateReport.total
                ? `${duplicateReport.total} şüpheli tekrar adayı`
                : "Şüpheli tekrar bulunmadı"}
            </strong>
            {duplicateReport.items?.length > 0 && (
              <div className="mini-list">
                {duplicateReport.items.slice(0, 8).map((item, index) => (
                  <p key={`${item.left.item_code}-${item.right.item_code}`}>
                    <b>#{index + 1}</b> {item.left.item_name}{" "}
                    <span className="muted">({item.left.item_code})</span> ↔{" "}
                    {item.right.item_name}{" "}
                    <span className="muted">({item.right.item_code})</span>{" "}
                    <Badge tone={item.score >= 0.95 ? "danger" : "warning"}>
                      %{Math.round(item.score * 100)}
                    </Badge>
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {mode === "commissions" && (
        <div className="info-banner">
          <TriangleAlert />
          <div>
            <strong>
              Komisyon verisi{" "}
              {marketplace === "TRENDYOL" ? "Trendyol" : "Hepsiburada"} API'den
              gelir
            </strong>
            <p>
              Bu ekranda manuel komisyon girilmez. Oranlar ürün sync sonrası
              seçili pazaryerinden gelen ürün verileriyle güncellenir.
            </p>
          </div>
        </div>
      )}
      {mode === "commissions" && missingCommissions.length > 0 && (
        <div className="info-banner warning">
          <TriangleAlert />
          <div>
            <strong>
              {missingCommissions.length} kategoride komisyon eksik
            </strong>
            <p>
              {missingCommissions
                .slice(0, 5)
                .map((item) => item.category_name || item.category_id)
                .join(", ")}
              {missingCommissions.length > 5 ? " ve diğerleri" : ""}
            </p>
          </div>
        </div>
      )}
      <div className="panel table-panel">
        <DataTable
          columns={columns}
          rows={paged}
          exportRows={filtered}
          columnVisibilityKey={`costs-${marketplace}-${mode}`}
          onRowClick={
            mode === "commissions" ? undefined : (row) => setEditing(row)
          }
        />
        <Pagination
          page={page}
          total={filtered.length}
          limit={limit}
          onChange={setPage}
        />
      </div>
      <ResourceModal
        mode={mode}
        value={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
        notify={notify}
        marketplace={marketplace}
      />
    </>
  );
}
function ResourceModal({ mode, value, onClose, onSaved, notify, marketplace }) {
  const [form, setForm] = useState(value || {}),
    [saving, setSaving] = useState(false),
    [preview, setPreview] = useState(null),
    [previewText, setPreviewText] = useState(""),
    [context, setContext] = useState(null),
    [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setForm(value || {});
    setPreview(null);
    setPreviewText("");
    setContext(null);
    if (mode === "costs" && value?.id)
      Promise.all([
        get(`/api/cost-items/${value.id}/usage`),
        get(`/api/cost-items/${value.id}/history`),
      ])
        .then(([usage, history]) =>
          setContext({ usage: usage.items, history: history.items }),
        )
        .catch(() => setContext({ usage: [], history: [] }));
    if (mode === "commissions" && value?.category_id)
      get(`/api/commissions/${value.category_id}/history`)
        .then((history) => setContext({ history: history.items }))
        .catch(() => setContext({ history: [] }));
  }, [mode, value]);
  if (!value) return null;
  async function runPreview() {
    try {
      const result = await post("/api/mappings/preview", {
        rows: parseBulkRows(form.text, mode).map((row) => ({
          ...row,
          marketplace,
        })),
      });
      if (!result.data.valid)
        throw new Error(
          `Doğrulama hatası: ${result.data.errors.length} sorun bulundu`,
        );
      setPreview(result.data);
      setPreviewText(form.text || "");
    } catch (error) {
      setPreview(null);
      notify(formatCostError(error), "error");
    }
  }
  async function save() {
    setSaving(true);
    try {
      if (value.bulk) {
        const rows = parseBulkRows(form.text, mode).map((row) => ({
          ...row,
          ...(mode === "mappings" ? { marketplace } : {}),
        }));
        if (mode === "costs") await post("/api/cost-items/bulk", { rows });
        else if (mode === "commissions")
          await post("/api/commissions/bulk", { rows });
        else {
          if (!preview || previewText !== (form.text || ""))
            throw new Error("Güncel satırları önce önizleyin");
          await post("/api/mappings/bulk-upsert", { rows });
        }
      } else if (value.clone) {
        const targetBarcodes = String(form.targetBarcodes || "")
          .split(/[\n,;\s]+/)
          .map((barcode) => barcode.trim())
          .filter(Boolean);
        await post("/api/mappings/clone", {
          sourceBarcode: form.sourceBarcode,
          targetBarcodes,
          marketplace,
        });
      } else if (mode === "costs") {
        const path = value.id
          ? `/api/cost-items/${value.id}`
          : "/api/cost-items";
        await (value.id ? patch(path, form) : post(path, form));
      } else if (mode === "mappings") {
        const mappingForm = normalizeMappingForm({ ...form, marketplace });
        await (value.id
          ? patch(`/api/mappings/${value.id}`, mappingForm)
          : post("/api/mappings", mappingForm));
      } else {
        const path = value.category_id
          ? `/api/commissions/${value.category_id}`
          : "/api/commissions";
        await (value.category_id ? patch(path, form) : post(path, form));
      }
      notify("Kayıt başarıyla kaydedildi");
      onSaved();
    } catch (e) {
      notify(formatCostError(e), "error");
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    try {
      const path =
        mode === "costs"
          ? `/api/cost-items/${value.id}`
          : mode === "mappings"
            ? `/api/mappings/${value.id}`
            : null;
      if (path) await del(path);
      notify("Kayıt silindi");
      setConfirmDelete(false);
      onSaved();
    } catch (e) {
      notify(e.message, "error");
    }
  }
  const set = (k, v) => setForm({ ...form, [k]: v });
  const modalTitle = value.clone
    ? "Mapping çoğalt"
    : value.bulk
      ? mode === "costs"
        ? "Toplu maliyet kalemi"
        : mode === "commissions"
          ? "Toplu komisyon"
          : "Toplu mapping"
      : "Kayıt düzenle";
  return (
    <Modal open onClose={onClose} title={modalTitle}>
      {value.clone ? (
        <div className="modal-body form-grid">
          <Field label="Kaynak barkod">
            <input
              value={form.sourceBarcode || ""}
              onChange={(event) => set("sourceBarcode", event.target.value)}
            />
          </Field>
          <Field label="Hedef barkodlar" hint="Her satıra bir barkod yazın">
            <textarea
              rows="10"
              value={form.targetBarcodes || ""}
              onChange={(event) => set("targetBarcodes", event.target.value)}
            />
          </Field>
        </div>
      ) : value.bulk ? (
        <div className="modal-body">
          <Field
            label={
              mode === "costs"
                ? "Cost Code, Kalem, Birim maliyet, Birim desi, Birim, Not"
                : mode === "commissions"
                  ? "Kategori ID, Kategori, Komisyon %, Not"
                  : "Barkod, Cost Code, Adet"
            }
            hint="Her satırı tab veya noktalı virgülle ayırın"
          >
            <textarea
              rows="14"
              value={form.text || ""}
              onChange={(e) => {
                set("text", e.target.value);
                setPreview(null);
              }}
              placeholder={
                mode === "costs"
                  ? "YUMUSATICI_ACTISOFT_1500ML\tActisoft Yumuşatıcı 1500 ml\t112\t1.5\tadet\t"
                  : mode === "commissions"
                    ? "2354\tYumuşatıcı\t17\t"
                    : "8690609598109\tYUMUSATICI_ACTISOFT_1500ML\t1"
              }
            />
          </Field>
          {preview && mode === "mappings" && (
            <div className="mapping-preview">
              <strong>
                {preview.products.length} barkod, {preview.rows.length} mapping
              </strong>
              <div className="table-wrap compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>Barkod</th>
                      <th>Kalem</th>
                      <th>Ürün maliyeti</th>
                      <th>Desi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.products.map((product) => (
                      <tr key={product.barcode}>
                        <td>{product.barcode}</td>
                        <td>{product.mapping_count}</td>
                        <td>{money(product.product_cost)}</td>
                        <td>{product.desi}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="modal-body form-grid">
          {mode === "costs" && (
            <>
              <Field label="Cost Code">
                <input
                  value={form.item_code || ""}
                  onChange={(e) => set("item_code", e.target.value)}
                />
              </Field>
              <Field label="Maliyet kalemi">
                <input
                  value={form.item_name || ""}
                  onChange={(e) => set("item_name", e.target.value)}
                />
              </Field>
              <Field label="Birim maliyet">
                <input
                  type="number"
                  step="0.01"
                  value={form.unit_cost || ""}
                  onChange={(e) => set("unit_cost", Number(e.target.value))}
                />
              </Field>
              <Field label="Birim desi">
                <input
                  type="number"
                  step="0.01"
                  value={form.unit_desi || ""}
                  onChange={(e) => set("unit_desi", Number(e.target.value))}
                />
              </Field>
              <Field label="Birim">
                <input
                  value={form.unit || "adet"}
                  onChange={(e) => set("unit", e.target.value)}
                />
              </Field>
              <Field label="Not">
                <input
                  value={form.note || ""}
                  onChange={(e) => set("note", e.target.value)}
                />
              </Field>
            </>
          )}
          {mode === "mappings" && (
            <>
              <Field label="Barkod">
                <input
                  value={form.barcode || ""}
                  onChange={(e) => set("barcode", e.target.value)}
                />
              </Field>
              <Field label="Cost Code">
                <input
                  value={form.cost_item_code || ""}
                  onChange={(e) => set("cost_item_code", e.target.value)}
                />
              </Field>
              <Field label="Adet">
                <input
                  type="number"
                  step="0.01"
                  value={form.quantity ?? 1}
                  onChange={(e) => set("quantity", Number(e.target.value))}
                />
              </Field>
            </>
          )}
          {mode === "commissions" && (
            <>
              <Field label="Kategori ID">
                <input
                  value={form.category_id || ""}
                  onChange={(e) => set("category_id", e.target.value)}
                />
              </Field>
              <Field label="Kategori adı">
                <input
                  value={form.category_name || ""}
                  onChange={(e) => set("category_name", e.target.value)}
                />
              </Field>
              <Field label="Komisyon %">
                <input
                  type="number"
                  step="0.01"
                  value={form.commission_rate || ""}
                  onChange={(e) =>
                    set("commission_rate", Number(e.target.value))
                  }
                />
              </Field>
              <Field label="Not">
                <input
                  value={form.note || ""}
                  onChange={(e) => set("note", e.target.value)}
                />
              </Field>
            </>
          )}
        </div>
      )}
      {!value.bulk && !value.clone && context && (
        <div className="modal-body resource-context">
          {context.usage && (
            <section>
              <h3>Kullanıldığı ürünler ({context.usage.length})</h3>
              {context.usage.length ? (
                <div className="table-wrap compact-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Barkod</th>
                        <th>Ürün</th>
                        <th>Adet</th>
                        <th>Satır maliyeti</th>
                      </tr>
                    </thead>
                    <tbody>
                      {context.usage.slice(0, 50).map((item) => (
                        <tr key={`${item.barcode}:${item.item_code}`}>
                          <td>{item.barcode}</td>
                          <td>{item.product_name || "-"}</td>
                          <td>{item.quantity}</td>
                          <td>{money(item.line_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>Bu kalem henüz bir üründe kullanılmıyor.</p>
              )}
            </section>
          )}
          {context.history && (
            <section>
              <h3>Değişiklik geçmişi</h3>
              {context.history.length ? (
                <ul className="history-list">
                  {context.history.slice(0, 20).map((entry) => (
                    <li key={entry.id}>
                      <span>{entry.action}</span>
                      <small>
                        {entry.actor} ·{" "}
                        {new Date(entry.created_at).toLocaleString("tr-TR")}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Henüz kayıtlı değişiklik yok.</p>
              )}
            </section>
          )}
        </div>
      )}
      <footer className="modal-actions">
        {value.id && mode !== "commissions" && (
          <Button
            variant="danger"
            icon={Trash2}
            onClick={() => setConfirmDelete(true)}
          >
            Sil
          </Button>
        )}
        <span />
        <Button variant="secondary" onClick={onClose}>
          Vazgeç
        </Button>
        {value.bulk && mode === "mappings" && (
          <Button
            variant="secondary"
            icon={Eye}
            onClick={runPreview}
            disabled={saving}
          >
            Önizle
          </Button>
        )}
        <Button icon={Save} onClick={save} disabled={saving}>
          {saving ? "Kaydediliyor" : "Kaydet"}
        </Button>
      </footer>
      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Kaydı sil"
        message="Bu kayıt kalıcı olarak silinecek. Kullanılan maliyet kalemleri güvenlik nedeniyle yine silinemez."
        confirmLabel="Kaydı sil"
      />
    </Modal>
  );
}
function Shipping({
  data,
  notify,
  reload,
  editing,
  setEditing,
  query,
  setQuery,
}) {
  const [type, setType] = useState("rates");
  const [calculator, setCalculator] = useState({
    sale_price: 300,
    desi: 1,
    carrier: data.carriers?.[0] || data.rates[0]?.carrier || "TEX",
  });
  const [calculation, setCalculation] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [importingTariff, setImportingTariff] = useState(false);
  useEffect(() => {
    get(`/api/shipping/coverage?marketplace=${query.marketplace}`)
      .then((result) => setCoverage(result.data))
      .catch(() => setCoverage(null));
  }, [query.marketplace]);
  useEffect(() => {
    const carriers = data.carriers || [];
    if (carriers.length && !carriers.includes(calculator.carrier))
      setCalculator((current) => ({ ...current, carrier: carriers[0] }));
  }, [data.carriers]);
  async function calculate() {
    try {
      const result = await post("/api/shipping/preview", {
        ...calculator,
        marketplace: query.marketplace,
      });
      setCalculation(result.data);
    } catch (error) {
      notify(error.message, "error");
    }
  }
  async function importHepsiburadaTariff() {
    setImportingTariff(true);
    try {
      const result = await post("/api/shipping/hepsiburada/import", {
        force: false,
      });
      notify(
        result.data?.metadata?.skipped
          ? "Hepsiburada tarifesi zaten yüklü"
          : `${Number(result.data?.successful || 0).toLocaleString("tr-TR")} Hepsiburada tarifesi yüklendi`,
      );
      await reload();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setImportingTariff(false);
    }
  }
  const sets = {
    rates: [
      "Desi tarifeleri",
      [
        { key: "carrier", label: "Kargo" },
        { key: "desi_kg", label: "Desi/KG" },
        {
          key: "cost_ex_vat",
          label: "KDV hariç",
          render: (r) => money(r.cost_ex_vat),
        },
        {
          key: "cost_inc_vat",
          label: "KDV dahil",
          render: (r) => money(r.cost_inc_vat),
        },
      ],
    ],
    barems: [
      "Sepet baremleri",
      [
        { key: "carrier", label: "Kargo" },
        { key: "barem_name", label: "Barem" },
        {
          key: "min_basket",
          label: "Min sepet",
          render: (r) => money(r.min_basket),
        },
        {
          key: "max_basket",
          label: "Maks sepet",
          render: (r) => money(r.max_basket),
        },
        {
          key: "cost_ex_vat",
          label: "KDV hariç",
          render: (r) => money(r.cost_ex_vat),
        },
        {
          key: "cost_inc_vat",
          label: "KDV dahil",
          render: (r) => money(r.cost_inc_vat),
        },
      ],
    ],
    packaging: [
      "Ambalaj profilleri",
      [
        { key: "profile_name", label: "Profil" },
        {
          key: "rule_scope",
          label: "Eşleşme türü",
          render: (r) =>
            ({
              BARCODE: "Barkod",
              PRODUCT_NAME: "Ürün adı",
              CATEGORY: "Kategori",
              BRAND: "Marka",
              DESI: "Eski desi",
            })[r.rule_scope || "DESI"],
        },
        {
          key: "match_value",
          label: "Eşleşme",
          render: (r) =>
            (r.rule_scope || "DESI") === "DESI"
              ? `${r.min_desi}–${r.max_desi} desi`
              : r.match_value,
        },
        { key: "packaging_type", label: "Ambalaj tipi" },
        {
          key: "packaging_cost",
          label: "Maliyet",
          render: (r) => money(r.packaging_cost),
        },
        { key: "priority", label: "Öncelik" },
        {
          key: "active",
          label: "Durum",
          render: (r) => (
            <Badge tone={r.active === false ? "neutral" : "success"}>
              {r.active === false ? "Pasif" : "Aktif"}
            </Badge>
          ),
        },
        { key: "note", label: "Not" },
      ],
    ],
  };
  const visibleSets = sets;
  const [label, cols] = sets[type];
  const pagination = data.pagination || {
    page: 1,
    limit: data.rates.length || 50,
    total: data.rates.length,
  };
  return (
    <>
      <div className="toolbar shipping-toolbar">
        {type === "rates" && (
          <>
            <select
              aria-label="Kargo firması filtresi"
              value={query.carrier}
              onChange={(event) =>
                setQuery({
                  ...query,
                  carrier: event.target.value,
                  page: 1,
                })
              }
            >
              <option value="">Tüm kargo firmaları</option>
              {(data.carriers || []).map((carrier) => (
                <option key={carrier} value={carrier}>
                  {carrier}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              aria-label="Desi filtresi"
              placeholder="Desi ara"
              value={query.desi}
              onChange={(event) =>
                setQuery({ ...query, desi: event.target.value, page: 1 })
              }
            />
          </>
        )}
        <Badge tone="info">
          {query.marketplace === "TRENDYOL" ? "Trendyol" : "Hepsiburada"}
          {type === "rates"
            ? ` · ${Number(pagination.total).toLocaleString("tr-TR")} tarife`
            : ""}
        </Badge>
      </div>
      <div className="tabs page-tabs">
        {Object.entries(visibleSets).map(([key, [name]]) => (
          <button
            key={key}
            className={type === key ? "active" : ""}
            onClick={() => setType(key)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="info-banner shipping-tariff-banner">
        {query.marketplace === "TRENDYOL" ? <Calculator /> : <Truck />}
        <div>
          <strong>
            {query.marketplace === "TRENDYOL"
              ? "Trendyol kargo maliyeti"
              : "Hepsiburada anlaşmalı kargo tarifesi"}
          </strong>
          {query.marketplace === "TRENDYOL" ? (
            <p>
              Paneldeki kargo tutarı KDV hariçtir. Hesap motoru yüzde 20 KDV
              eklenmiş gerçek ödeme tutarını kullanır.
            </p>
          ) : (
            <p>
              {pagination.total > 0
                ? "13 Temmuz 2026 tarihli kaynak tarifeden aktarılmıştır. Hepsiburada baremleri ve ambalaj kuralları ayrı tablolardan uygulanır."
                : "Henüz Hepsiburada tarifesi yüklenmemiş. Paketli 13 Temmuz 2026 tarifesini güvenli biçimde içe aktarabilirsiniz."}
            </p>
          )}
        </div>
        {query.marketplace === "HEPSIBURADA" && pagination.total === 0 && (
          <Button
            icon={Upload}
            variant="secondary"
            onClick={importHepsiburadaTariff}
            disabled={importingTariff}
          >
            {importingTariff ? "Yükleniyor" : "Tarifeyi yükle"}
          </Button>
        )}
      </div>
      {(coverage?.warnings?.length || 0) > 0 && (
        <div className="info-banner warning">
          <TriangleAlert />
          <div>
            <strong>{coverage.warnings.length} eksik desi tarifesi</strong>
            <p>
              {coverage.warnings
                .slice(0, 8)
                .map((warning) => `${warning.carrier} ${warning.desi} desi`)
                .join(", ")}
              {coverage.warnings.length > 8 ? " ve diğerleri" : ""}
            </p>
          </div>
        </div>
      )}
      <section className="panel shipping-calculator">
        <div className="panel-header">
          <div>
            <h2>Kargo maliyeti hesapla</h2>
            <p>
              Kargo desiye göre; ambalaj barkod, ürün adı, kategori veya marka
              profiline göre hesaplanır.
            </p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Satış fiyatı">
            <input
              type="number"
              step="0.01"
              value={calculator.sale_price}
              onChange={(event) =>
                setCalculator({
                  ...calculator,
                  sale_price: Number(event.target.value),
                })
              }
            />
          </Field>
          <Field label="Desi">
            <input
              type="number"
              step="0.01"
              value={calculator.desi}
              onChange={(event) =>
                setCalculator({
                  ...calculator,
                  desi: Number(event.target.value),
                })
              }
            />
          </Field>
          <Field label="Kargo firması">
            <select
              value={calculator.carrier}
              onChange={(event) =>
                setCalculator({ ...calculator, carrier: event.target.value })
              }
            >
              {(data.carriers || []).map((carrier) => (
                <option key={carrier}>{carrier}</option>
              ))}
            </select>
          </Field>
          <div className="field action-field">
            <Button icon={Calculator} onClick={calculate}>
              Hesapla
            </Button>
          </div>
        </div>
        {calculation && (
          <div className="metric-row calculation-result">
            <div>
              <span>Kargo kaynağı</span>
              <b>{calculation.shippingSource}</b>
            </div>
            <div>
              <span>Kargo</span>
              <b>{money(calculation.shippingCost)}</b>
            </div>
            <div>
              <span>Ambalaj</span>
              <b>{money(calculation.packagingCost)}</b>
            </div>
            <div>
              <span>Toplam</span>
              <b>{money(calculation.totalFulfillmentCost)}</b>
            </div>
          </div>
        )}
      </section>
      <div className="panel table-panel">
        <DataTable
          columns={cols}
          rows={data[type] || []}
          columnVisibilityKey={`shipping-${query.marketplace}-${type}`}
          onRowClick={
            query.marketplace === "HEPSIBURADA" && type === "rates"
              ? undefined
              : (row) => setEditing({ ...row, type })
          }
        />
        {type === "rates" && (
          <Pagination
            page={pagination.page}
            total={pagination.total}
            limit={pagination.limit}
            onChange={(page) => setQuery({ ...query, page })}
          />
        )}
      </div>
      <ShippingModal
        value={editing}
        type={type}
        onClose={() => setEditing(null)}
        notify={notify}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
    </>
  );
}
function ShippingModal({ value, type, onClose, notify, onSaved }) {
  const initial =
    (value?.type || type) === "packaging" && !value?.id
      ? {
          ...value,
          rule_scope: "PRODUCT_NAME",
          packaging_type: "STANDARD",
          profile_name: "",
          match_value: "",
          packaging_cost: 0,
          priority: 100,
          active: true,
        }
      : value || {};
  const [form, setForm] = useState(initial),
    [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setForm(initial), [value, type]);
  if (!value) return null;
  const actual = value.type || type;
  const set = (k, v) => setForm({ ...form, [k]: v });
  async function save() {
    try {
      if (actual === "rates")
        await (value.id
          ? patch(`/api/shipping/rates/${value.id}`, form)
          : post("/api/shipping/rates", form));
      else if (actual === "barems")
        await (value.id
          ? patch(`/api/shipping/barems/${value.id}`, form)
          : post("/api/shipping/barems", form));
      else
        await (value.id
          ? patch(`/api/packaging-rules/${value.id}`, form)
          : post("/api/packaging-rules", form));
      notify("Kural kaydedildi");
      onSaved();
    } catch (e) {
      notify(e.message, "error");
    }
  }
  async function remove() {
    try {
      const path =
        actual === "rates"
          ? `/api/shipping/rates/${value.id}`
          : actual === "barems"
            ? `/api/shipping/barems/${value.id}`
            : `/api/packaging-rules/${value.id}`;
      await del(path);
      notify("Kural silindi");
      setConfirmDelete(false);
      onSaved();
    } catch (e) {
      notify(e.message, "error");
    }
  }
  return (
    <Modal open onClose={onClose} title="Kargo / ambalaj kuralı">
      <div className="modal-body form-grid">
        {actual === "rates" && (
          <>
            <Field label="Kargo firması">
              <input
                value={form.carrier || "TEX"}
                onChange={(e) => set("carrier", e.target.value)}
              />
            </Field>
            <Field label="Desi / KG">
              <input
                type="number"
                value={form.desi_kg || 0}
                onChange={(e) => set("desi_kg", Number(e.target.value))}
              />
            </Field>
            <Field label="KDV hariç maliyet">
              <input
                type="number"
                step="0.01"
                value={form.cost_ex_vat || 0}
                onChange={(e) => set("cost_ex_vat", Number(e.target.value))}
              />
            </Field>
          </>
        )}
        {actual === "barems" && (
          <>
            <Field label="Kargo firması">
              <input
                value={form.carrier || "TEX"}
                onChange={(e) => set("carrier", e.target.value)}
              />
            </Field>
            <Field label="Barem adı">
              <input
                value={form.barem_name || ""}
                onChange={(e) => set("barem_name", e.target.value)}
              />
            </Field>
            <Field label="Min sepet">
              <input
                type="number"
                value={form.min_basket || 0}
                onChange={(e) => set("min_basket", Number(e.target.value))}
              />
            </Field>
            <Field label="Maks sepet">
              <input
                type="number"
                value={form.max_basket || 0}
                onChange={(e) => set("max_basket", Number(e.target.value))}
              />
            </Field>
            <Field label="KDV hariç maliyet">
              <input
                type="number"
                step="0.01"
                value={form.cost_ex_vat || 0}
                onChange={(e) => set("cost_ex_vat", Number(e.target.value))}
              />
            </Field>
          </>
        )}
        {actual === "packaging" && (
          <>
            <Field label="Profil adı">
              <input
                value={form.profile_name || ""}
                placeholder="Örn. Yumuşatıcı koli + balon"
                onChange={(e) => set("profile_name", e.target.value)}
              />
            </Field>
            <Field label="Eşleşme türü">
              <select
                value={form.rule_scope || "DESI"}
                onChange={(e) => set("rule_scope", e.target.value)}
              >
                <option value="BARCODE">Barkod istisnası</option>
                <option value="PRODUCT_NAME">Ürün adında geçiyorsa</option>
                <option value="CATEGORY">Kategori adında geçiyorsa</option>
                <option value="BRAND">Marka eşleşiyorsa</option>
                <option value="DESI">Eski desi kuralı</option>
              </select>
            </Field>
            {(form.rule_scope || "DESI") === "DESI" ? (
              <>
                <Field label="Min desi">
                  <input
                    type="number"
                    value={form.min_desi || 0}
                    onChange={(e) => set("min_desi", Number(e.target.value))}
                  />
                </Field>
                <Field label="Maks desi">
                  <input
                    type="number"
                    value={form.max_desi || 0}
                    onChange={(e) => set("max_desi", Number(e.target.value))}
                  />
                </Field>
              </>
            ) : (
              <Field label="Eşleşme değeri">
                <input
                  value={form.match_value || ""}
                  placeholder={
                    form.rule_scope === "BARCODE"
                      ? "Ürün barkodu"
                      : "Ürün adında/kategoride aranacak ifade"
                  }
                  onChange={(e) => set("match_value", e.target.value)}
                />
              </Field>
            )}
            <Field label="Ambalaj tipi">
              <select
                value={form.packaging_type || "STANDARD"}
                onChange={(e) => set("packaging_type", e.target.value)}
              >
                <option value="MAILER">Kargo poşeti</option>
                <option value="BOX">Koli</option>
                <option value="BOX_BUBBLE">Koli + balonlu koruma</option>
                <option value="BUBBLE">Balonlu koruma</option>
                <option value="STANDARD">Standart koruma</option>
                <option value="LEGACY_DESI">Eski desi kuralı</option>
              </select>
            </Field>
            <Field label="Maliyet">
              <input
                type="number"
                step="0.01"
                value={form.packaging_cost || 0}
                onChange={(e) => set("packaging_cost", Number(e.target.value))}
              />
            </Field>
            <Field label="Öncelik">
              <input
                type="number"
                min="0"
                value={form.priority || 0}
                onChange={(e) => set("priority", Number(e.target.value))}
              />
            </Field>
            <Field label="Durum">
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={form.active !== false}
                  onChange={(e) => set("active", e.target.checked)}
                />
                <span>Aktif</span>
              </label>
            </Field>
            <Field label="Not">
              <input
                value={form.note || ""}
                onChange={(e) => set("note", e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
      <footer className="modal-actions">
        {value.id && (
          <Button
            variant="danger"
            icon={Trash2}
            onClick={() => setConfirmDelete(true)}
          >
            Sil
          </Button>
        )}
        <span />
        <Button variant="secondary" onClick={onClose}>
          Vazgeç
        </Button>
        <Button icon={Save} onClick={save}>
          Kaydet
        </Button>
      </footer>
      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Kuralı sil"
        message="Bu kargo veya ambalaj kuralı kalıcı olarak silinecek ve ürün maliyetleri yeniden hesaplanacak."
        confirmLabel="Kuralı sil"
      />
    </Modal>
  );
}
