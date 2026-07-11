import React, { useEffect, useState } from "react";
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
  const rows = payload.items.filter((r) =>
    `${r.barcode} ${r.product_name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const cols = [
    { key: "barcode", label: "Barkod" },
    { key: "product_name", label: "Ürün" },
    { key: "my_price", label: "Mevcut", render: (r) => money(r.my_price) },
    {
      key: "buybox_price",
      label: "Buybox",
      render: (r) => money(r.buybox_price),
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
        <DataTable columns={cols} rows={rows} />
      </div>
    </>
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
            <DataTable columns={cols} rows={items} />
          </div>
        )
      )}
    </>
  );
}
function Actions({ notify }) {
  const [data, setData] = useState(null),
    [status, setStatus] = useState(""),
    [confirm, setConfirm] = useState(null);
  async function load() {
    setData(await get(`/api/actions${status ? `?status=${status}` : ""}`));
  }
  useEffect(() => {
    load().catch((e) => notify(e.message, "error"));
  }, [status]);
  async function act(action, row) {
    try {
      await post(`/api/actions/${row.id}/${action}`);
      notify(
        action === "apply"
          ? "Aksiyon dry-run güvenliğiyle işlendi"
          : "Aksiyon güncellendi",
      );
      setConfirm(null);
      load();
    } catch (e) {
      notify(e.message, "error");
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
              onClick={() => setConfirm(r)}
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
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      <div className="panel table-panel">
        <DataTable columns={cols} rows={data.items} />
      </div>
      <Confirm
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => act("apply", confirm)}
        title="Fiyat aksiyonunu uygula"
        message="Aksiyon tüm güvenlik kontrollerinden yeniden geçecek. Global dry-run açıksa Trendyol'a hiçbir fiyat gönderilmeyecek."
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
            icon={Pause}
            label="Duraklat"
            onClick={() => action(r.barcode, "pause")}
          />
        </div>
      ),
    },
  ];
  return (
    <div className="panel table-panel">
      <DataTable columns={cols} rows={rows} />
    </div>
  );
}
function Jobs({ notify }) {
  const [data, setData] = useState(null);
  async function load() {
    setData(await get("/api/jobs"));
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
  if (!data) return <Loading />;
  const cols = [
    { key: "name", label: "Job" },
    { key: "description", label: "Açıklama" },
    {
      key: "schedule_minutes",
      label: "Sıklık",
      render: (r) => `${r.schedule_minutes} dk`,
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
    <div className="panel table-panel">
      <DataTable columns={cols} rows={data.items} />
    </div>
  );
}
function Logs() {
  const [type, setType] = useState("audit");
  return (
    <Remote url={`/api/logs?type=${type}`}>
      {(data) => (
        <>
          <div className="tabs page-tabs">
            <button
              className={type === "audit" ? "active" : ""}
              onClick={() => setType("audit")}
            >
              Kullanıcı / Audit
            </button>
            <button
              className={type === "integration" ? "active" : ""}
              onClick={() => setType("integration")}
            >
              Entegrasyon
            </button>
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
            />
          </div>
        </>
      )}
    </Remote>
  );
}
function Settings({ notify, setDryRun }) {
  const [data, setData] = useState(null),
    [form, setForm] = useState({});
  useEffect(() => {
    get("/api/settings").then((x) => {
      setData(x);
      setForm(Object.fromEntries(x.items.map((i) => [i.key, i.value])));
    });
  }, []);
  if (!data) return <Loading />;
  async function save() {
    try {
      await patch("/api/settings", form);
      setDryRun(Boolean(form.global_dry_run));
      notify("Sistem ayarları kaydedildi");
    } catch (e) {
      notify(e.message, "error");
    }
  }
  const bools = [
    ["global_dry_run", "Global dry-run"],
    ["global_repricer_enabled", "Global repricer"],
    ["google_sheets_sync_enabled", "Google Sheets sync"],
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
            ["global_max_price_change_pct", "Maksimum değişim %"],
            ["service_fee", "Hizmet bedeli"],
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
          <Button icon={Save} onClick={save}>
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
    </>
  );
}
