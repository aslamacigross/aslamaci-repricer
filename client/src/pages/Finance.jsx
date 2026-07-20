import React, { useMemo, useState } from "react";
import {
  Banknote,
  CreditCard,
  History,
  PackageCheck,
  RefreshCw,
  Save,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { get, post, put } from "../lib/api";
import {
  Badge,
  Button,
  ErrorState,
  Field,
  Loading,
  PageHeader,
  useRemote,
} from "../components/ui";
import DataTable, { money } from "../components/DataTable";

function monthInIstanbul(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}`;
}

const currentMonth = monthInIstanbul();
const expenseColors = ["#b4232a", "#d6831f", "#146c94", "#725aa3", "#59645e"];

export default function Finance({ notify, marketplace = "TRENDYOL" }) {
  const [month, setMonth] = useState(currentMonth);
  const [syncing, setSyncing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const { data, loading, error, reload } = useRemote(
    () => get(`/api/finance/monthly?month=${month}&marketplace=${marketplace}`),
    [month, marketplace],
  );
  const report = data?.data;
  const [packaging, setPackaging] = useState("");
  const packagingValue =
    packaging === "" ? report?.summary?.packaging || 0 : packaging;
  const cards = useMemo(
    () =>
      report
        ? [
            [
              "Net satış",
              report.summary.sales_revenue,
              TrendingUp,
              "info",
              true,
            ],
            ["Komisyon", report.summary.commission, Banknote, "warning", true],
            [
              "Ürün alış maliyeti",
              report.summary.product_cost,
              CreditCard,
              "warning",
              report.coverage.profitability_complete,
            ],
            [
              "Operasyonel kâr",
              report.summary.profit_after_packaging,
              Banknote,
              "success",
              report.coverage.profitability_complete,
            ],
            [
              "Senin finanse ettiğin",
              report.summary.financed_by_bekir,
              WalletCards,
              "warning",
              report.coverage.profitability_complete,
            ],
            [
              "Sana aktarılacak",
              report.summary.transfer_to_bekir,
              PackageCheck,
              "success",
              report.coverage.profitability_complete,
            ],
          ]
        : [],
    [report],
  );
  const expenseBreakdown = useMemo(() => {
    if (!report) return [];
    const exactItems = [
      { name: "Komisyon", value: Number(report.summary.commission) },
      { name: "Ambalaj", value: Number(report.summary.packaging) },
    ];
    const detailedItems = [
      { name: "Ürün alış", value: Number(report.summary.product_cost) },
      { name: "Kargo", value: Number(report.summary.shipping) },
      { name: "Hizmet", value: Number(report.summary.service_fee) },
    ];
    return [
      ...exactItems,
      ...(report.coverage.profitability_complete ? detailedItems : []),
    ].filter((item) => item.value > 0);
  }, [report]);

  async function sync() {
    setSyncing(true);
    try {
      await post("/api/finance/sync", { marketplace });
      await reload();
      notify("Sipariş ve finans kayıtları yenilendi");
    } catch (nextError) {
      notify(nextError.message, "error");
    } finally {
      setSyncing(false);
    }
  }

  async function backfillHistory() {
    setBackfilling(true);
    try {
      await post("/api/finance/history/backfill", { marketplace });
      await reload();
      notify("15 Aralık 2025'ten itibaren finans geçmişi tamamlandı");
    } catch (nextError) {
      notify(nextError.message, "error");
    } finally {
      setBackfilling(false);
    }
  }

  async function savePackaging() {
    try {
      await put("/api/finance/packaging", {
        month,
        amount: Number(packagingValue),
        marketplace,
      });
      setPackaging("");
      await reload();
      notify("Aylık ambalaj gideri kaydedildi");
    } catch (nextError) {
      notify(nextError.message, "error");
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={reload} />;
  return (
    <>
      <PageHeader
        title="Satış & Kâr"
        description={`${marketplace === "TRENDYOL" ? "Trendyol" : "Hepsiburada"} sipariş, nakit ihtiyacı ve aylık mutabakatı`}
        actions={
          <>
            {marketplace === "TRENDYOL" && (
              <Button
                icon={History}
                variant="secondary"
                onClick={backfillHistory}
                disabled={backfilling}
              >
                {backfilling ? "Geçmiş tamamlanıyor" : "Geçmişi tamamla"}
              </Button>
            )}
            <Button icon={RefreshCw} onClick={sync} disabled={syncing}>
              {syncing ? "Finans verisi çekiliyor" : "Siparişleri yenile"}
            </Button>
          </>
        }
      />
      <div className="toolbar finance-toolbar">
        <Field label="Rapor ayı">
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </Field>
        <Field label="Aylık ambalaj gideri">
          <input
            type="number"
            min="0"
            step="0.01"
            value={packagingValue}
            onChange={(event) => setPackaging(event.target.value)}
          />
        </Field>
        <Button icon={Save} variant="secondary" onClick={savePackaging}>
          Ambalajı kaydet
        </Button>
        <Badge tone={report.transactions.length ? "success" : "warning"}>
          {report.transactions.length
            ? "Finansal hareketler var"
            : "Settlement bekleniyor"}
        </Badge>
        <Badge
          tone={
            report.coverage.status === "COMPLETE"
              ? "success"
              : report.coverage.status === "NO_DATA"
                ? "neutral"
                : "warning"
          }
        >
          {report.coverage.status === "NO_DATA"
            ? "Bu ay satış verisi yok"
            : report.coverage.status === "COMPLETE"
              ? "Sipariş detayı tam"
              : "Satış geçmişi var, kâr detayı kısmi"}
        </Badge>
      </div>
      {report.summary.sales_source === "SETTLEMENT" && (
        <div className="notice notice-info">
          <strong>Finans kayıtlarıyla doğrulanan satış</strong>
          <p>
            İptal sonrası satış {money(report.summary.settlement_gross_sales)},
            iade {money(Math.abs(report.summary.settlement_returns))}, indirim
            ve kupon {money(Math.abs(report.summary.settlement_discounts))}.
          </p>
        </div>
      )}
      <section className="kpi-grid finance-kpis">
        {cards.map(([label, value, Icon, tone, available]) => (
          <div className={`kpi kpi-${tone}`} key={label}>
            <div>
              <span>{label}</span>
              <strong>{available ? money(value) : "Detay bekliyor"}</strong>
            </div>
            <Icon />
          </div>
        ))}
      </section>
      <section className="dashboard-grid">
        <div className="panel chart-panel">
          <header>
            <h2>Günlük satış ve kâr</h2>
            <span>{report.summary.sales_order_count} sipariş</span>
          </header>
          <ResponsiveContainer width="100%" height={290}>
            <LineChart data={report.charts.daily}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis />
              <Tooltip formatter={(value) => money(value)} />
              <Line dataKey="revenue" name="Ciro" stroke="#146c94" />
              <Line dataKey="profit" name="Kâr" stroke="#21845f" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel chart-panel">
          <header>
            <h2>Saat bazlı sipariş</h2>
            <span>Türkiye saati</span>
          </header>
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={report.charts.hourly}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="orders" name="Sipariş" fill="#176b52" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="dashboard-grid finance-breakdown">
        <div className="panel chart-panel">
          <header>
            <h2>Gider kırılımı</h2>
            <span>Operasyonel nakit görünümü</span>
          </header>
          {expenseBreakdown.length ? (
            <div className="expense-layout">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={expenseBreakdown}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={54}
                    outerRadius={88}
                  >
                    {expenseBreakdown.map((item, index) => (
                      <Cell
                        key={item.name}
                        fill={expenseColors[index % expenseColors.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => money(value)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="expense-legend">
                {expenseBreakdown.map((item, index) => (
                  <div key={item.name}>
                    <span
                      style={{
                        background: expenseColors[index % expenseColors.length],
                      }}
                    />
                    <b>{item.name}</b>
                    <strong>{money(item.value)}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="empty-copy">Bu ay için gider kaydı bulunmuyor.</p>
          )}
        </div>
        <div className="panel chart-panel">
          <header>
            <h2>Şehir dağılımı</h2>
            <span>En yüksek sipariş hacmi</span>
          </header>
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={report.charts.cities} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis
                dataKey="city"
                type="category"
                width={92}
                tick={{ fontSize: 11 }}
              />
              <Tooltip />
              <Bar dataKey="orders" name="Sipariş" fill="#146c94" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="dashboard-grid">
        <div className="panel table-panel">
          <header>
            <h2>En güçlü ürünler</h2>
          </header>
          <DataTable
            columns={[
              { key: "barcode", label: "Barkod" },
              { key: "product_name", label: "Ürün" },
              { key: "quantity", label: "Adet" },
              {
                key: "revenue",
                label: "Ciro",
                render: (row) => money(row.revenue),
              },
              {
                key: "contribution",
                label: "Katkı",
                render: (row) => money(row.contribution),
              },
            ]}
            rows={report.products}
            columnVisibilityKey="finance-products"
          />
        </div>
        <div className="panel finance-insights">
          <header>
            <h2>Akıllı analiz</h2>
          </header>
          {report.insights.length ? (
            report.insights.map((insight) => (
              <article key={insight.title}>
                <Badge tone={insight.tone}>{insight.title}</Badge>
                <p>{insight.text}</p>
              </article>
            ))
          ) : (
            <p>Bu ay için kritik bir operasyonel uyarı bulunmuyor.</p>
          )}
          <div className="notice notice-info">
            <strong>Mutabakat yöntemi</strong>
            <p>{report.methodology.transfer}</p>
            <p>{report.methodology.warning}</p>
            <p>{report.methodology.vat}</p>
          </div>
        </div>
      </section>
    </>
  );
}
