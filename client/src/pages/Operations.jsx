import React, { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  RefreshCw,
  Play,
  Eye,
  Check,
  Send,
  X,
  Pause,
  RotateCcw,
  Save,
  ShieldAlert,
  CloudDownload,
  CloudUpload,
  Activity,
  Pencil,
} from "lucide-react";
import { get, post, patch } from "../lib/api";
import DataTable, { money, percent, date } from "../components/DataTable";
import {
  PageHeader,
  IconButton,
  Button,
  Loading,
  ErrorState,
  Badge,
  toneFor,
  SearchInput,
  Confirm,
  Field,
  Pagination,
  Modal,
  Drawer,
} from "../components/ui";
const info = {
  buybox: [
    "Buybox",
    "Pazar sırası ve rakip fiyatlarını güncel verilerle izleyin",
  ],
  repricer: [
    "Repricer",
    "Fiyat kararlarını göndermeden önce açıklamalı olarak önizleyin",
  ],
  actions: [
    "Fiyat Aksiyonları",
    "Bekleyen, onaylanan ve sonuçlanan fiyat işlemleri",
  ],
  learning: [
    "Öğrenme Merkezi",
    "Ürün bazlı fiyat kırma sonuçları ve güven skoru",
  ],
  jobs: ["Joblar", "Otomatik görevleri ve çalışma geçmişini yönetin"],
  logs: ["Loglar", "Entegrasyon, kullanıcı ve sistem olaylarını izleyin"],
  settings: ["Sistem Ayarları", "Global güvenlik ve operasyon varsayılanları"],
};
export default function Operations({ mode, notify, setDryRun }) {
  const [refresh, setRefresh] = useState(0);
  const [t, d] = info[mode];
  return (
    <>
      <PageHeader
        title={t}
        description={d}
        actions={
          <IconButton
            icon={RefreshCw}
            label="Yenile"
            onClick={() => setRefresh((x) => x + 1)}
          />
        }
      />
      {mode === "buybox" && <Buybox key={refresh} />}{" "}
      {mode === "repricer" && <Repricer key={refresh} notify={notify} />}{" "}
      {mode === "actions" && <Actions key={refresh} notify={notify} />}{" "}
      {mode === "learning" && <Learning key={refresh} notify={notify} />}{" "}
      {mode === "jobs" && <Jobs key={refresh} notify={notify} />}{" "}
      {mode === "logs" && <Logs key={refresh} />}{" "}
      {mode === "settings" && (
        <Settings key={refresh} notify={notify} setDryRun={setDryRun} />
      )}
    </>
  );
}
function Remote({ url, children }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(null);
  useEffect(() => {
    get(url).then(setData).catch(setError);
  }, [url]);
  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading />;
  return children(data);
}
function Buybox() {
  return (
    <Remote url="/api/buybox?limit=200">
      {(payload) => <BuyboxTable payload={payload} />}
    </Remote>
  );
}
// Kept separate so hooks remain stable while Remote supplies the payload.
function BuyboxTable({ payload }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const rows = payload.items.filter((r) =>
    `${r.barcode} ${r.product_name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const cols = [
    { key: "barcode", label: "Barkod" },
    { key: "product_name", label: "Ürün" },
    { key: "strategy", label: "Öğrenilen strateji" },
    { key: "my_price", label: "Mevcut", render: (r) => money(r.my_price) },
    {
      key: "buybox_price",
      label: "Buybox",
      render: (r) => money(r.buybox_price),
    },
    {
      key: "learned_max_increase_tl",
      label: "Öğrenilen maks. artış",
      render: (r) =>
        r.learned_max_increase_tl == null
          ? "-"
          : money(r.learned_max_increase_tl),
    },
    {
      key: "second_price",
      label: "2. fiyat",
      render: (r) => money(r.second_price),
    },
    {
      key: "third_price",
      label: "3. fiyat",
      render: (r) => money(r.third_price),
    },
    {
      key: "rank",
      label: "Sıra",
      render: (r) => (
        <Badge tone={r.rank === 1 ? "success" : "warning"}>
          {r.rank || "-"}
        </Badge>
      ),
    },
    {
      key: "has_multiple_seller",
      label: "Çoklu satıcı",
      render: (r) => (r.has_multiple_seller ? "Evet" : "Hayır"),
    },
    { key: "min_price", label: "Min fiyat", render: (r) => money(r.min_price) },
    {
      key: "calculated_net_profit",
      label: "Net kâr",
      render: (r) => money(r.calculated_net_profit),
    },
    {
      key: "buybox_updated_at",
      label: "Son kontrol",
      render: (r) => date(r.buybox_updated_at),
    },
    { key: "last_action", label: "Önerilen aksiyon", badge: true },
    {
      key: "last_proposed_price",
      label: "Önerilen fiyat",
      render: (r) =>
        r.last_proposed_price == null ? "-" : money(r.last_proposed_price),
    },
  ];
  return (
    <>
      <div className="filters">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Barkod veya ürün ara"
        />
      </div>
      <div className="panel table-panel">
        <DataTable
          columns={cols}
          rows={rows}
          onRowClick={setSelected}
          columnVisibilityKey="buybox"
        />
      </div>
      <BuyboxHistory product={selected} onClose={() => setSelected(null)} />
    </>
  );
}
function BuyboxHistory({ product, onClose }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    setItems(null);
    if (!product) return;
    get(`/api/products/${product.barcode}/buybox-history`)
      .then((result) => setItems(result.items || []))
      .catch(() => setItems([]));
  }, [product]);
  const chartData = [...(items || [])].reverse().map((item) => ({
    ...item,
    label: new Date(item.observed_at).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
  return (
    <Drawer
      open={Boolean(product)}
      onClose={onClose}
      title={product ? `${product.barcode} buybox geçmişi` : "Buybox geçmişi"}
      wide
    >
      {!items ? (
        <Loading />
      ) : items.length ? (
        <>
          <div className="drawer-chart">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} minTickGap={36} />
                <YAxis domain={["auto", "auto"]} />
                <Tooltip formatter={(value) => money(value)} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="observed_price"
                  name="Bizim fiyat"
                  stroke="#146c94"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="buybox_price"
                  name="Buybox"
                  stroke="#21845f"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="second_price"
                  name="2. fiyat"
                  stroke="#b98418"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <DataTable
            columns={[
              {
                key: "observed_at",
                label: "Tarih",
                render: (row) => date(row.observed_at),
              },
              {
                key: "observed_price",
                label: "Bizim fiyat",
                render: (row) => money(row.observed_price),
              },
              {
                key: "buybox_price",
                label: "Buybox",
                render: (row) => money(row.buybox_price),
              },
              { key: "rank", label: "Sıra" },
            ]}
            rows={items.slice(0, 100)}
          />
        </>
      ) : (
        <div className="state">Bu ürün için buybox geçmişi bulunmuyor.</div>
      )}
    </Drawer>
  );
}
function Repricer({ notify }) {
  const [barcode, setBarcode] = useState(""),
    [items, setItems] = useState(null),
    [loading, setLoading] = useState(false);
  async function preview() {
    setLoading(true);
    try {
      const x = await post("/api/repricer/preview", {
        barcode: barcode || undefined,
      });
      setItems(x.items);
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setLoading(false);
    }
  }
  async function generate() {
    setLoading(true);
    try {
      const x = await post("/api/repricer/generate-actions", {
        barcode: barcode || undefined,
      });
      notify(`${x.data.created} aksiyon oluşturuldu`);
      setItems(null);
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setLoading(false);
    }
  }
  const cols = [
    { key: "barcode", label: "Barkod" },
    { key: "productName", label: "Ürün" },
    { key: "action", label: "Aksiyon", badge: true },
    { key: "oldPrice", label: "Mevcut", render: (r) => money(r.oldPrice) },
    {
      key: "proposedPrice",
      label: "Önerilen",
      render: (r) => money(r.proposedPrice),
    },
    { key: "difference", label: "Fark", render: (r) => money(r.difference) },
    {
      key: "expectedProfit",
      label: "Beklenen kâr",
      render: (r) => money(r.expectedProfit),
    },
    { key: "rank", label: "Sıra" },
    { key: "targetRank", label: "Hedef sıra" },
    {
      key: "effectiveUndercut",
      label: "Fiyat kırma",
      render: (r) => money(r.effectiveUndercut),
    },
    { key: "reason", label: "Neden" },
    {
      key: "blockedReasons",
      label: "Güvenlik",
      render: (r) =>
        r.blockedReasons.length ? (
          <Badge tone="danger">{r.blockedReasons.length} engel</Badge>
        ) : (
          <Badge tone="success">Güvenli</Badge>
        ),
    },
  ];
  return (
    <>
      <div className="info-banner warning">
        <ShieldAlert />
        <div>
          <strong>Önizleme fiyat göndermez</strong>
          <p>
            Global dry-run ve tüm ürün güvenlik kontrolleri aksiyon uygulama
            anında yeniden doğrulanır.
          </p>
        </div>
      </div>
      <div className="command-bar">
        <input
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          placeholder="İsteğe bağlı barkod"
        />
        <Button
          variant="secondary"
          icon={Eye}
          onClick={preview}
          disabled={loading}
        >
          Önizle
        </Button>
        <Button icon={Play} onClick={generate} disabled={loading}>
          Aksiyon oluştur
        </Button>
      </div>
      {loading ? (
        <Loading />
      ) : (
        items && (
          <div className="panel table-panel">
            <DataTable
              columns={cols}
              rows={items}
              columnVisibilityKey="repricer-preview"
            />
          </div>
        )
      )}
    </>
  );
}
function Actions({ notify }) {
  const [data, setData] = useState(null),
    [status, setStatus] = useState(""),
    [confirm, setConfirm] = useState(null),
    [selected, setSelected] = useState([]),
    [editing, setEditing] = useState(null);
  async function load() {
    setData(await get(`/api/actions${status ? `?status=${status}` : ""}`));
    setSelected([]);
  }
  async function bulkApprove() {
    try {
      await post("/api/actions/bulk-approve", { ids: selected });
      notify(`${selected.length} aksiyon onaylandı`);
      setConfirm(null);
      load();
    } catch (e) {
      notify(e.message, "error");
    }
  }
  useEffect(() => {
    load().catch((e) => notify(e.message, "error"));
  }, [status]);
  async function act(action, row) {
    try {
      await post(
        `/api/actions/${row.id}/${action}`,
        action === "recheck" ? { elapsedMinutes: 5 } : {},
      );
      notify(
        action === "apply"
          ? "Aksiyon dry-run güvenliğiyle işlendi"
          : action === "recheck"
            ? "Aksiyon sonucu yeniden kontrol edildi"
            : action === "revert"
              ? "Geri alma aksiyonu oluşturuldu; ayrıca onaylanması gerekir"
              : "Aksiyon güncellendi",
      );
      setConfirm(null);
      load();
    } catch (e) {
      notify(e.message, "error");
    }
  }
  async function editAndApprove() {
    try {
      await post(`/api/actions/${editing.id}/edit-and-approve`, {
        proposedPrice: Number(editing.proposed_price),
        reason: editing.reason,
      });
      notify("Fiyat düzenlendi ve aksiyon onaylandı");
      setEditing(null);
      load();
    } catch (error) {
      notify(error.message, "error");
    }
  }
  if (!data) return <Loading />;
  const cols = [
    { key: "created_at", label: "Tarih", render: (r) => date(r.created_at) },
    { key: "barcode", label: "Barkod" },
    { key: "product_name", label: "Ürün" },
    { key: "action", label: "Aksiyon", badge: true },
    { key: "old_price", label: "Eski", render: (r) => money(r.old_price) },
    {
      key: "proposed_price",
      label: "Yeni",
      render: (r) => money(r.proposed_price),
    },
    { key: "min_price", label: "Min", render: (r) => money(r.min_price) },
    { key: "target_rank", label: "Hedef sıra" },
    { key: "rank_after", label: "Son sıra" },
    { key: "source", label: "Kaynak", badge: true },
    { key: "status", label: "Durum", badge: true },
    { key: "reason", label: "Sebep" },
    {
      key: "ops",
      label: "İşlem",
      render: (r) => (
        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
          {r.status === "PENDING" && (
            <>
              <IconButton
                icon={Check}
                label="Onayla"
                onClick={() => act("approve", r)}
              />
              <IconButton
                icon={Pencil}
                label="Fiyatı düzenle ve onayla"
                onClick={() => setEditing({ ...r })}
              />
              <IconButton
                icon={X}
                label="Reddet"
                onClick={() => act("reject", r)}
              />
            </>
          )}
          {r.status === "APPROVED" && (
            <IconButton
              icon={Send}
              label="Uygula"
              onClick={() => setConfirm({ type: "apply", row: r })}
            />
          )}
          {r.status === "AWAITING_RESULT" && (
            <IconButton
              icon={RefreshCw}
              label="Sonucu tekrar kontrol et"
              onClick={() => act("recheck", r)}
            />
          )}
          {r.status === "SUCCESS" && !r.reverted_by_action_id && (
            <IconButton
              icon={RotateCcw}
              label="Güvenli geri alma aksiyonu oluştur"
              onClick={() => setConfirm({ type: "revert", row: r })}
            />
          )}
        </div>
      ),
    },
  ];
  return (
    <>
      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tüm durumlar</option>
          {[
            "PENDING",
            "APPROVED",
            "DRY_RUN",
            "AWAITING_RESULT",
            "SUCCESS",
            "FAILED",
            "REJECTED",
            "REVERTED",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <Button
          variant="secondary"
          icon={Check}
          disabled={!selected.length}
          onClick={() => setConfirm("bulk")}
        >
          Seçilenleri onayla ({selected.length})
        </Button>
      </div>
      <div className="panel table-panel">
        <DataTable
          columns={cols}
          rows={data.items}
          selectedIds={selected}
          onSelectionChange={setSelected}
          canSelectRow={(row) => row.status === "PENDING"}
          columnVisibilityKey="actions"
        />
      </div>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Fiyatı düzenle ve onayla"
      >
        {editing && (
          <>
            <div className="modal-body form-grid">
              <Field label="Barkod">
                <input value={editing.barcode} disabled />
              </Field>
              <Field label="Minimum fiyat">
                <input value={money(editing.min_price)} disabled />
              </Field>
              <Field label="Yeni fiyat">
                <input
                  type="number"
                  step="0.01"
                  min={editing.min_price}
                  value={editing.proposed_price}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      proposed_price: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Aksiyon sebebi">
                <input
                  value={editing.reason || ""}
                  onChange={(event) =>
                    setEditing({ ...editing, reason: event.target.value })
                  }
                />
              </Field>
            </div>
            <footer className="modal-actions">
              <span />
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Vazgeç
              </Button>
              <Button icon={Check} onClick={editAndApprove}>
                Düzenle ve onayla
              </Button>
            </footer>
          </>
        )}
      </Modal>
      <Confirm
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          confirm === "bulk" ? bulkApprove() : act(confirm.type, confirm.row)
        }
        title={
          confirm === "bulk"
            ? "Seçili aksiyonları onayla"
            : confirm?.type === "revert"
              ? "Fiyat aksiyonunu geri al"
              : "Fiyat aksiyonunu uygula"
        }
        message={
          confirm === "bulk"
            ? `${selected.length} bekleyen aksiyon onaylanacak; fiyatlar henüz gönderilmeyecek.`
            : confirm?.type === "revert"
              ? "Eski fiyata dönmek için yeni ve bağlı bir aksiyon oluşturulacak. Bu aksiyon ayrıca onaylanmadan ve güvenlik kontrollerinden geçmeden gönderilmeyecek."
              : "Aksiyon tüm güvenlik kontrollerinden yeniden geçecek. Global dry-run açıksa Trendyol'a hiçbir fiyat gönderilmeyecek."
        }
      />
    </>
  );
}
function Learning({ notify }) {
  return (
    <Remote url="/api/learning">
      {(data) => <LearningTable data={data} notify={notify} />}
    </Remote>
  );
}
function LearningTable({ data, notify }) {
  const [rows, setRows] = useState(data.items);
  async function action(barcode, type) {
    try {
      await post(`/api/learning/${barcode}/${type}`);
      notify(
        type === "reset"
          ? "Öğrenilen değer sıfırlandı"
          : type === "resume"
            ? "Öğrenme devam ettirildi"
            : "Öğrenme duraklatıldı",
      );
      setRows((await get("/api/learning")).items);
    } catch (e) {
      notify(e.message, "error");
    }
  }
  const cols = [
    { key: "barcode", label: "Barkod" },
    { key: "product_name", label: "Ürün" },
    {
      key: "learned_price_cut_tl",
      label: "Öğrenilen kırma",
      render: (r) => money(r.learned_price_cut_tl),
    },
    { key: "failed_attempts", label: "Başarısız" },
    { key: "success_attempts", label: "Başarılı" },
    { key: "last_outcome", label: "Son sonuç", badge: true },
    { key: "consecutive_failures", label: "Seri hata" },
    {
      key: "confidence_score",
      label: "Güven",
      render: (r) => percent(Number(r.confidence_score) * 100),
    },
    {
      key: "paused",
      label: "Durum",
      render: (r) => (
        <Badge tone={r.paused ? "warning" : "success"}>
          {r.paused ? "Duraklatıldı" : "Öğreniyor"}
        </Badge>
      ),
    },
    {
      key: "ops",
      label: "İşlem",
      render: (r) => (
        <div className="row-actions">
          <IconButton
            icon={RotateCcw}
            label="Sıfırla"
            onClick={() => action(r.barcode, "reset")}
          />
          <IconButton
            icon={r.paused ? Play : Pause}
            label={r.paused ? "Devam ettir" : "Duraklat"}
            onClick={() => action(r.barcode, r.paused ? "resume" : "pause")}
          />
        </div>
      ),
    },
  ];
  return (
    <div className="panel table-panel">
      <DataTable columns={cols} rows={rows} columnVisibilityKey="learning" />
    </div>
  );
}
function Jobs({ notify }) {
  const [data, setData] = useState(null);
  async function load() {
    const [jobs, runs] = await Promise.all([
      get("/api/jobs"),
      get("/api/jobs/runs?limit=100"),
    ]);
    setData({ items: jobs.items, runs: runs.items });
  }
  useEffect(() => {
    load();
  }, []);
  async function run(name) {
    try {
      notify(`${name} başlatıldı`, "info");
      await post(`/api/jobs/${name}/run`);
      notify(`${name} tamamlandı`);
      load();
    } catch (e) {
      notify(e.message, "error");
    }
  }
  async function updateJob(name, values) {
    try {
      await patch(`/api/jobs/${name}`, values);
      notify("Job ayarı kaydedildi");
      load();
    } catch (e) {
      notify(e.message, "error");
    }
  }
  if (!data) return <Loading />;
  const cols = [
    { key: "name", label: "Job" },
    { key: "description", label: "Açıklama" },
    {
      key: "schedule_minutes",
      label: "Sıklık",
      render: (r) => (
        <input
          className="table-number-input"
          type="number"
          min="1"
          value={r.schedule_minutes}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const value = Number(event.target.value);
            setData((current) => ({
              ...current,
              items: current.items.map((item) =>
                item.name === r.name
                  ? { ...item, schedule_minutes: value }
                  : item,
              ),
            }));
          }}
          onBlur={(event) =>
            updateJob(r.name, { schedule_minutes: Number(event.target.value) })
          }
        />
      ),
    },
    {
      key: "enabled",
      label: "Aktif",
      render: (r) => (
        <label className="toggle compact-toggle">
          <input
            type="checkbox"
            checked={Boolean(r.enabled)}
            onChange={(event) =>
              updateJob(r.name, { enabled: event.target.checked })
            }
          />
          <span />
        </label>
      ),
    },
    { key: "last_status", label: "Son durum", badge: true },
    {
      key: "last_started_at",
      label: "Son çalışma",
      render: (r) => date(r.last_started_at),
    },
    {
      key: "last_duration_ms",
      label: "Süre",
      render: (r) => (r.last_duration_ms ? `${r.last_duration_ms} ms` : "-"),
    },
    { key: "last_processed_count", label: "İşlenen" },
    {
      key: "run",
      label: "",
      render: (r) => (
        <IconButton
          icon={Play}
          label="Şimdi çalıştır"
          onClick={() => run(r.name)}
        />
      ),
    },
  ];
  return (
    <>
      <div className="panel table-panel">
        <DataTable
          columns={cols}
          rows={data.items}
          columnVisibilityKey="jobs"
        />
      </div>
      <div className="section-heading">
        <div>
          <h2>Çalışma geçmişi</h2>
          <p>Son 100 job çalışması</p>
        </div>
      </div>
      <div className="panel table-panel">
        <DataTable
          columns={[
            { key: "job_name", label: "Job" },
            { key: "status", label: "Durum", badge: true },
            {
              key: "started_at",
              label: "Başlangıç",
              render: (r) => date(r.started_at),
            },
            {
              key: "duration_ms",
              label: "Süre",
              render: (r) => `${r.duration_ms || 0} ms`,
            },
            { key: "processed_count", label: "İşlenen" },
            { key: "successful_count", label: "Başarılı" },
            { key: "failed_count", label: "Hatalı" },
            { key: "error", label: "Hata" },
          ]}
          rows={data.runs}
          columnVisibilityKey="job-runs"
        />
      </div>
    </>
  );
}
function Logs() {
  const [type, setType] = useState("audit"),
    [level, setLevel] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const params = new URLSearchParams({ type, page: String(page), limit: "50" });
  if (level) params.set("level", level);
  if (search) params.set("search", search);
  return (
    <Remote url={`/api/logs?${params}`}>
      {(data) => (
        <>
          <div className="tabs page-tabs">
            <button
              className={type === "audit" ? "active" : ""}
              onClick={() => {
                setType("audit");
                setLevel("");
                setPage(1);
              }}
            >
              Kullanıcı / Audit
            </button>
            <button
              className={type === "integration" ? "active" : ""}
              onClick={() => {
                setType("integration");
                setPage(1);
              }}
            >
              Entegrasyon
            </button>
          </div>
          <div className="filters">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Kullanıcı, aksiyon, entegrasyon veya mesaj ara"
            />
            {type === "integration" && (
              <select
                value={level}
                onChange={(event) => {
                  setLevel(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Tüm seviyeler</option>
                <option value="INFO">Bilgi</option>
                <option value="WARN">Uyarı</option>
                <option value="ERROR">Hata</option>
              </select>
            )}
          </div>
          <div className="panel table-panel">
            <DataTable
              columns={[
                {
                  key: "created_at",
                  label: "Tarih",
                  render: (r) => date(r.created_at),
                },
                { key: "type", label: "Tür" },
                { key: "level", label: "Seviye", badge: true },
                { key: "actor", label: "Kullanıcı" },
                { key: "action", label: "Aksiyon" },
                { key: "entity_id", label: "Kayıt" },
                { key: "message", label: "Mesaj" },
              ]}
              rows={data.items}
              columnVisibilityKey={`logs-${type}`}
            />
          </div>
          <Pagination
            page={page}
            total={data.total || 0}
            limit={50}
            onChange={setPage}
          />
        </>
      )}
    </Remote>
  );
}
function Settings({ notify, setDryRun }) {
  const [data, setData] = useState(null),
    [form, setForm] = useState({}),
    [baseline, setBaseline] = useState({}),
    [confirmLive, setConfirmLive] = useState(false);
  useEffect(() => {
    get("/api/settings").then((x) => {
      const values = Object.fromEntries(x.items.map((i) => [i.key, i.value]));
      setData(x);
      setForm(values);
      setBaseline(values);
    });
  }, []);
  if (!data) return <Loading />;
  async function save(confirmed = false) {
    const enablesLivePricing =
      baseline.global_dry_run !== false && form.global_dry_run === false;
    const enablesAutomaticRepricer =
      baseline.global_repricer_enabled !== true &&
      form.global_repricer_enabled === true;
    if ((enablesLivePricing || enablesAutomaticRepricer) && !confirmed) {
      setConfirmLive(true);
      return;
    }
    try {
      await patch("/api/settings", {
        ...form,
        ...(confirmed ? { confirmation: "CANLI_FIYAT_MODUNU_AC" } : {}),
      });
      setDryRun(Boolean(form.global_dry_run));
      setBaseline({ ...form });
      setConfirmLive(false);
      notify("Sistem ayarları kaydedildi");
    } catch (e) {
      notify(e.message, "error");
    }
  }
  const bools = [
    ["global_dry_run", "Global dry-run"],
    ["global_repricer_enabled", "Global repricer"],
    ["google_sheets_sync_enabled", "Google Sheets sync"],
    ["maintenance_mode", "Bakım modu"],
  ];
  return (
    <>
      <div className="settings-band">
        <div>
          <Activity />
          <section>
            <strong>Fiyat güvenlik durumu</strong>
            <p>Dry-run açıkken hiçbir aksiyon Trendyol'a gönderilmez.</p>
          </section>
        </div>
        <Badge tone={form.global_dry_run ? "warning" : "danger"}>
          {form.global_dry_run ? "DRY-RUN AÇIK" : "CANLI MOD"}
        </Badge>
      </div>
      <div className="panel settings-form">
        <h2>Global kontroller</h2>
        {bools.map(([key, label]) => (
          <label className="toggle setting-toggle" key={key}>
            <input
              type="checkbox"
              checked={Boolean(form[key])}
              onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
            />
            <span />
            {label}
          </label>
        ))}
        <div className="form-grid">
          {[
            ["default_target_profit", "Varsayılan minimum kâr"],
            ["default_price_cut_tl", "Varsayılan fiyat kırma"],
            ["default_max_increase_tl", "Varsayılan maksimum artış"],
            ["global_max_price_change_pct", "Maksimum değişim %"],
            ["service_fee", "Hizmet bedeli"],
            ["buybox_max_age_minutes", "Buybox veri yaşı (dk)"],
            ["product_sync_cron_minutes", "Ürün sync sıklığı (dk)"],
            ["buybox_sync_cron_minutes", "Buybox sync sıklığı (dk)"],
            ["cost_calculation_cron_minutes", "Maliyet hesabı sıklığı (dk)"],
            ["repricer_cron_minutes", "Repricer sıklığı (dk)"],
            ["sheets_sync_cron_minutes", "Sheets import sıklığı (dk)"],
            ["log_retention_days", "Log saklama (gün)"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                step="0.01"
                value={form[key] ?? ""}
                onChange={(e) =>
                  setForm({ ...form, [key]: Number(e.target.value) })
                }
              />
            </Field>
          ))}
          <Field label="Varsayılan kargo">
            <input
              value={form.default_carrier || ""}
              onChange={(e) =>
                setForm({ ...form, default_carrier: e.target.value })
              }
            />
          </Field>
        </div>
        <div className="form-actions">
          <Button icon={Save} onClick={() => save(false)}>
            Ayarları kaydet
          </Button>
        </div>
      </div>
      <div className="panel integration-actions">
        <h2>Google Sheets geçiş araçları</h2>
        <p>
          PostgreSQL ana veri kaynağıdır. Import önce tüm sekmeleri doğrular;
          hata olursa çalışan DB verisine dokunmaz.
        </p>
        <div>
          <Button
            variant="secondary"
            icon={CloudDownload}
            onClick={() =>
              post("/api/integrations/sheets/import")
                .then(() => notify("Sheet import tamamlandı"))
                .catch((e) => notify(e.message, "error"))
            }
          >
            Sheet'ten içe aktar
          </Button>
          <Button
            variant="secondary"
            icon={CloudUpload}
            onClick={() =>
              post("/api/integrations/sheets/export")
                .then(() => notify("Sheet export tamamlandı"))
                .catch((e) => notify(e.message, "error"))
            }
          >
            Sheet'e dışa aktar
          </Button>
        </div>
      </div>
      <Confirm
        open={confirmLive}
        onClose={() => setConfirmLive(false)}
        onConfirm={() => save(true)}
        title="Canlı fiyat güvenliğini değiştir"
        message="Dry-run kapatılıyor veya otomatik repricer açılıyor. Bu değişiklikten sonra ayrıca onaylanan fiyat aksiyonları Trendyol'a gönderilebilir. Devam etmek istediğinizden emin misiniz?"
        confirmLabel="Canlı modu onayla"
      />
    </>
  );
}
