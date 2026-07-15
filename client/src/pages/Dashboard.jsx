import React, { useState } from "react";
import {
  Package,
  PackageCheck,
  GitBranch,
  Percent,
  TrendingDown,
  Trophy,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Boxes,
  Activity,
} from "lucide-react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { get, post } from "../lib/api";
import {
  PageHeader,
  Loading,
  ErrorState,
  Badge,
  toneFor,
  Button,
  Drawer,
  IconButton,
  useRemote,
} from "../components/ui";
import DataTable, { money, percent, date } from "../components/DataTable";
const cards = [
  ["total_products", "Toplam ürün", Boxes, "neutral"],
  ["active_products", "Aktif ürün", PackageCheck, "success"],
  ["complete_products", "Verisi tam", ShieldCheck, "success"],
  ["missing_mapping", "Mapping eksik", GitBranch, "warning"],
  ["cost_data_issue", "Maliyet sorunu", TriangleAlert, "warning"],
  ["missing_commission", "Komisyon eksik", Percent, "warning"],
  ["missing_shipping", "Kargo eksik", Package, "warning"],
  ["loss_products", "Zarardaki ürün", TrendingDown, "danger"],
  ["below_minimum", "Min fiyat altı", TriangleAlert, "danger"],
  ["buybox_owned", "Buybox bizde", Trophy, "success"],
  ["buybox_available", "Buybox alınabilir", Trophy, "info"],
  ["buybox_outside", "Buybox dışında", Package, "warning"],
  ["stale_buybox", "Eski buybox verisi", TriangleAlert, "danger"],
  ["auto_update_enabled", "Otomatik repricer", Activity, "info"],
  ["actions_24h", "24 saat aksiyon", RefreshCw, "info"],
  ["successful_actions_24h", "Başarılı aksiyon", ShieldCheck, "success"],
  ["failed_actions_24h", "Başarısız aksiyon", TriangleAlert, "danger"],
];
export default function Dashboard({ notify }) {
  const { data, loading, error, reload } = useRemote(
    () => get("/api/dashboard"),
    [],
  );
  const [liveRefreshing, setLiveRefreshing] = useState(false),
    [metricDetail, setMetricDetail] = useState(null);
  async function refreshLiveData() {
    setLiveRefreshing(true);
    try {
      const response = await post("/api/dashboard/live-refresh");
      await reload();
      const failed = (response.data?.runs || []).filter(
        (run) => run.status === "FAILED",
      ).length;
      notify?.(
        failed
          ? `Canlı veri yenilendi; ${failed} job hata verdi`
          : "Canlı veri yenilendi",
        failed ? "warning" : "success",
      );
    } catch (nextError) {
      notify?.(nextError.message, "error");
    } finally {
      setLiveRefreshing(false);
    }
  }
  async function openMetric([key, label]) {
    setMetricDetail({ key, label, loading: true, items: [] });
    try {
      const response = await get(`/api/dashboard/metrics/${key}?limit=100`);
      setMetricDetail({ key, label, loading: false, ...response.data });
    } catch (nextError) {
      setMetricDetail(null);
      notify?.(nextError.message, "error");
    }
  }
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const d = data.data,
    k = d.kpis || {};
  const productSync = d.jobs.find((job) => job.job_name === "sync-products"),
    buyboxSync = d.jobs.find((job) => job.job_name === "sync-buybox"),
    dryRun = d.settings?.global_dry_run !== false,
    repricerEnabled = d.settings?.global_repricer_enabled === true;
  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description="Mağaza sağlığı, kârlılık ve repricer operasyonlarının güncel özeti"
        actions={
          <>
            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={refreshLiveData}
              disabled={liveRefreshing}
            >
              {liveRefreshing ? "Canlı veri çekiliyor" : "Canlı veriyi çek"}
            </Button>
            <IconButton icon={RefreshCw} label="Yenile" onClick={reload} />
          </>
        }
      />
      <section className="kpi-grid">
        {cards.map((card) => {
          const [key, label, Icon, tone] = card;
          return (
            <button
              type="button"
              className={`kpi kpi-${tone} kpi-clickable`}
              key={key}
              onClick={() => openMetric(card)}
            >
              <div>
                <span>{label}</span>
                <strong>{k[key] ?? 0}</strong>
                {key === "total_products" && (
                  <small>
                    {k.stocked_products || 0} stoklu (platform verisi)
                  </small>
                )}
              </div>
              <Icon />
            </button>
          );
        })}
      </section>
      <section className="dashboard-grid">
        <div className="panel chart-panel">
          <header>
            <h2>Kategori dağılımı</h2>
            <span>En büyük 12 kategori</span>
          </header>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={d.charts.categories}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={80}
              />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#176b52" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel chart-panel">
          <header>
            <h2>Kategori marjları</h2>
            <span>Ortalama net marj</span>
          </header>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={d.charts.categories}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={80}
              />
              <YAxis />
              <Tooltip />
              <Bar dataKey="margin" fill="#146c94" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="dashboard-grid">
        <div className="panel chart-panel">
          <header>
            <h2>Strateji başarısı</h2>
            <span>Son 90 gün hedef sıra başarısı</span>
          </header>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={d.charts.strategies || []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis unit="%" />
              <Tooltip />
              <Bar
                dataKey="success_rate"
                name="Başarı %"
                fill="#21845f"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel chart-panel">
          <header>
            <h2>Öğrenilen fiyat kırma</h2>
            <span>Ürünlerin fiyat adımı dağılımı</span>
          </header>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={d.charts.learnedSteps || []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar
                dataKey="count"
                name="Ürün"
                fill="#146c94"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="dashboard-grid">
        <div className="panel chart-panel">
          <header>
            <h2>Fiyat aksiyonları</h2>
            <span>Son 14 gün</span>
          </header>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={d.charts.actions}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#146c94" />
              <Line type="monotone" dataKey="successful" stroke="#21845f" />
              <Line type="monotone" dataKey="failed" stroke="#b93838" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel chart-panel">
          <header>
            <h2>Buybox kazanma / kaybetme</h2>
            <span>Ölçülmüş sonuçlar</span>
          </header>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={d.charts.buybox}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="won" stroke="#21845f" />
              <Line type="monotone" dataKey="lost" stroke="#b93838" />
              <Line
                type="monotone"
                dataKey="target_achieved"
                stroke="#7a5c13"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="dashboard-grid">
        <div className="panel list-panel">
          <header>
            <h2>En kârlı ürünler</h2>
            <span>Net kâr</span>
          </header>
          {d.topProfit.map((x) => (
            <div className="rank-row" key={x.barcode}>
              <div>
                <strong>{x.product_name}</strong>
                <small>{x.barcode}</small>
              </div>
              <div>
                <b>{money(x.value)}</b>
                <span>{percent(x.margin)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="panel list-panel">
          <header>
            <h2>Riskli ürünler</h2>
            <span>Öncelikli kontrol</span>
          </header>
          {d.topRisk.map((x) => (
            <div className="rank-row" key={x.barcode}>
              <div>
                <strong>{x.product_name}</strong>
                <small>{x.barcode}</small>
              </div>
              <div>
                <Badge tone={toneFor(x.reason)}>{x.reason}</Badge>
                <span>{percent(x.margin)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel integrations-strip">
        <div>
          <span>Ortalama net marj</span>
          <strong>{percent(k.average_margin)}</strong>
        </div>
        <div>
          <span>Son hata</span>
          <strong>{d.lastError?.message || "Hata yok"}</strong>
          <small>{date(d.lastError?.created_at)}</small>
        </div>
        <div>
          <span>Güvenlik modu</span>
          <strong>{dryRun ? "DRY-RUN AÇIK" : "CANLI MOD"}</strong>
          <small>
            Repricer {repricerEnabled ? "açık" : "kapalı"} · Bakım modu{" "}
            {d.settings?.maintenance_mode ? "açık" : "kapalı"}
          </small>
        </div>
        <div>
          <span>Son ürün sync</span>
          <strong>{productSync?.last_status || "Henüz çalışmadı"}</strong>
          <small>{date(productSync?.last_started_at)}</small>
        </div>
        <div>
          <span>Son buybox sync</span>
          <strong>{buyboxSync?.last_status || "Henüz çalışmadı"}</strong>
          <small>{date(buyboxSync?.last_started_at)}</small>
        </div>
      </section>
      <MetricDrawer
        detail={metricDetail}
        onClose={() => setMetricDetail(null)}
      />
    </>
  );
}

function MetricDrawer({ detail, onClose }) {
  const open = Boolean(detail);
  const productColumns = [
    { key: "barcode", label: "Barkod" },
    { key: "product_name", label: "Ürün" },
    { key: "brand", label: "Marka" },
    { key: "category_name", label: "Kategori" },
    {
      key: "is_active",
      label: "Aktif",
      render: (row) => (row.is_active ? "Evet" : "Hayır"),
      badge: true,
    },
    { key: "stock_quantity", label: "Stok" },
    { key: "my_price", label: "Fiyat", render: (row) => money(row.my_price) },
    { key: "mapping_count", label: "Mapping" },
    {
      key: "calculated_product_cost",
      label: "Ürün maliyeti",
      render: (row) => money(row.calculated_product_cost),
    },
    {
      key: "desi",
      label: "Desi",
      render: (row) =>
        row.desi == null ? "-" : Number(row.desi).toLocaleString("tr-TR"),
    },
    {
      key: "calculated_shipping_cost",
      label: "Kargo",
      render: (row) => money(row.calculated_shipping_cost),
    },
    { key: "min_price", label: "Min", render: (row) => money(row.min_price) },
    { key: "rank", label: "Sıra" },
    {
      key: "calculated_net_profit",
      label: "Net kâr",
      render: (row) => money(row.calculated_net_profit),
    },
    {
      key: "calculated_net_margin",
      label: "Marj",
      render: (row) => percent(row.calculated_net_margin),
    },
    { key: "data_status", label: "Veri", badge: true },
    { key: "data_issue_label", label: "Eksik nedeni", badge: true },
    {
      key: "auto_update",
      label: "Oto",
      render: (row) => (row.auto_update ? "Açık" : "Kapalı"),
      badge: true,
    },
    {
      key: "buybox_updated_at",
      label: "Buybox kontrol",
      render: (row) => date(row.buybox_updated_at),
    },
  ];
  const actionColumns = [
    {
      key: "created_at",
      label: "Tarih",
      render: (row) => date(row.created_at),
    },
    { key: "barcode", label: "Barkod" },
    { key: "product_name", label: "Ürün" },
    { key: "action", label: "Aksiyon", badge: true },
    { key: "status", label: "Durum", badge: true },
    { key: "old_price", label: "Eski", render: (row) => money(row.old_price) },
    {
      key: "proposed_price",
      label: "Yeni",
      render: (row) => money(row.proposed_price),
    },
    { key: "min_price", label: "Min", render: (row) => money(row.min_price) },
    { key: "source", label: "Kaynak", badge: true },
    { key: "reason", label: "Sebep" },
  ];
  const columns = detail?.type === "actions" ? actionColumns : productColumns;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`${detail?.label || "Metrik"} detayı`}
      wide
    >
      {detail?.loading ? (
        <Loading label="Detay verisi yükleniyor" />
      ) : (
        <>
          <p className="muted-note">
            İlk {detail?.limit || 100} kayıt gösteriliyor. Tam liste için ilgili
            ürün veya aksiyon ekranındaki filtreleri kullanabilirsiniz.
          </p>
          <DataTable
            columns={columns}
            rows={detail?.items || []}
            columnVisibilityKey={`dashboard-metric-${detail?.key}`}
            exportFileName={`dashboard-${detail?.key}`}
          />
        </>
      )}
    </Drawer>
  );
}
