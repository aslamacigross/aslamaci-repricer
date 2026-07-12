import React from "react";
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
import { get } from "../lib/api";
import {
  PageHeader,
  Loading,
  ErrorState,
  Badge,
  toneFor,
  IconButton,
  useRemote,
} from "../components/ui";
import { money, percent, date } from "../components/DataTable";
const cards = [
  ["total_products", "Toplam ürün", Boxes, "neutral"],
  ["active_products", "Aktif ürün", PackageCheck, "success"],
  ["complete_products", "Verisi tam", ShieldCheck, "success"],
  ["missing_mapping", "Mapping eksik", GitBranch, "warning"],
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
];
export default function Dashboard() {
  const { data, loading, error, reload } = useRemote(
    () => get("/api/dashboard"),
    [],
  );
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const d = data.data,
    k = d.kpis || {};
  const lastJob = [...(d.jobs || [])].sort(
    (a, b) =>
      new Date(b.last_started_at || 0) - new Date(a.last_started_at || 0),
  )[0];
  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description="Mağaza sağlığı, kârlılık ve repricer operasyonlarının güncel özeti"
        actions={
          <IconButton icon={RefreshCw} label="Yenile" onClick={reload} />
        }
      />
      <section className="kpi-grid">
        {cards.map(([key, label, Icon, tone]) => (
          <article className={`kpi kpi-${tone}`} key={key}>
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
          </article>
        ))}
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
          <span>Job durumu</span>
          <strong>
            {d.jobs.filter((j) => j.last_status === "SUCCESS").length}/
            {d.jobs.length} başarılı
          </strong>
          <small>Son sync: {date(lastJob?.last_started_at)}</small>
        </div>
      </section>
    </>
  );
}
