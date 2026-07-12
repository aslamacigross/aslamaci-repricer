import React, { useEffect, useState } from "react";
import {
  RefreshCw,
  SlidersHorizontal,
  Save,
  Calculator,
  History,
  ShieldAlert,
} from "lucide-react";
import { get, patch, post } from "../lib/api";
import DataTable, {
  money,
  percent,
  date,
  downloadCsv,
} from "../components/DataTable";
import {
  PageHeader,
  SearchInput,
  IconButton,
  Button,
  Loading,
  ErrorState,
  Drawer,
  Badge,
  toneFor,
  Pagination,
  Field,
} from "../components/ui";
const columns = [
  { key: "barcode", label: "Barkod" },
  { key: "product_name", label: "Ürün", width: 310 },
  { key: "brand", label: "Marka" },
  { key: "category_name", label: "Kategori" },
  { key: "category_id", label: "Kategori ID" },
  { key: "stock_quantity", label: "Stok" },
  {
    key: "is_active",
    label: "Aktif",
    render: (r) => (
      <Badge tone={r.is_active ? "success" : "neutral"}>
        {r.is_active ? "Aktif" : "Pasif"}
      </Badge>
    ),
  },
  { key: "my_price", label: "Fiyat", render: (r) => money(r.my_price) },
  {
    key: "commission_rate",
    label: "Komisyon",
    render: (r) => percent(r.commission_rate),
  },
  { key: "desi", label: "Desi" },
  {
    key: "calculated_product_cost",
    label: "Ürün maliyeti",
    render: (r) => money(r.calculated_product_cost),
  },
  {
    key: "calculated_shipping_cost",
    label: "Kargo",
    render: (r) => money(r.calculated_shipping_cost),
  },
  {
    key: "packaging_cost",
    label: "Ambalaj",
    render: (r) => money(r.packaging_cost),
  },
  {
    key: "service_fee",
    label: "Hizmet",
    render: (r) => money(r.service_fee),
  },
  {
    key: "target_profit",
    label: "Minimum kâr",
    render: (r) => money(r.target_profit),
  },
  {
    key: "calculated_net_profit",
    label: "Net kâr",
    render: (r) => (
      <span
        className={
          Number(r.calculated_net_profit) < 0 ? "text-danger" : "text-success"
        }
      >
        {money(r.calculated_net_profit)}
      </span>
    ),
  },
  {
    key: "calculated_net_margin",
    label: "Marj",
    render: (r) => percent(r.calculated_net_margin),
  },
  { key: "min_price", label: "Min fiyat", render: (r) => money(r.min_price) },
  {
    key: "buybox_price",
    label: "Buybox fiyatı",
    render: (r) => money(r.buybox_price),
  },
  { key: "rank", label: "Sıra", render: (r) => r.rank || "-" },
  {
    key: "auto_update",
    label: "Auto update",
    render: (r) => (
      <Badge tone={r.auto_update ? "success" : "neutral"}>
        {r.auto_update ? "Açık" : "Kapalı"}
      </Badge>
    ),
  },
  { key: "strategy", label: "Strateji" },
  {
    key: "learned_price_cut_tl",
    label: "Öğrenilen kırma",
    render: (r) => money(r.learned_price_cut_tl),
  },
  { key: "data_status", label: "Veri", badge: true },
  { key: "repricer_mode", label: "Mod", badge: true },
  { key: "last_action", label: "Son aksiyon", badge: true },
  {
    key: "updated_at",
    label: "Son güncelleme",
    render: (r) => date(r.updated_at),
  },
];
const initialFilters = {
  search: "",
  status: "",
  active: "",
  stocked: "",
  autoUpdate: "",
  mode: "",
  category: "",
  brand: "",
  page: 1,
  limit: 50,
};
export default function Products({ notify }) {
  const [filters, setFilters] = useState(initialFilters),
    [result, setResult] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null),
    [selected, setSelected] = useState(null),
    [detail, setDetail] = useState(null),
    [tab, setTab] = useState("cost"),
    [saving, setSaving] = useState(false);
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v !== ""),
      );
      setResult(await get(`/api/products?${query}`));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const id = setTimeout(load, filters.search ? 300 : 0);
    return () => clearTimeout(id);
  }, [filters]);
  async function open(row) {
    setSelected(row);
    setDetail(null);
    try {
      const [x, b] = await Promise.all([
        get(`/api/products/${row.barcode}`),
        get(`/api/products/${row.barcode}/cost-breakdown`),
      ]);
      setDetail({ ...x.data, breakdown: b.data });
    } catch (e) {
      notify(e.message, "error");
    }
  }
  async function save() {
    setSaving(true);
    try {
      const body = detail.settings || {};
      await patch(`/api/products/${detail.barcode}`, body);
      notify("Repricer ayarları kaydedildi");
      await open(detail);
      load();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }
  async function exportAll(exportColumns) {
    try {
      const limit = 1000;
      const query = new URLSearchParams(
        Object.entries({ ...filters, page: 1, limit }).filter(
          ([, value]) => value !== "",
        ),
      );
      const first = await get(`/api/products?${query}`);
      const items = [...first.items];
      const pages = Math.ceil(first.total / limit);
      for (let page = 2; page <= pages; page++) {
        query.set("page", page);
        items.push(...(await get(`/api/products?${query}`)).items);
      }
      downloadCsv(exportColumns, items, "urunler");
      notify(`${items.length} ürün CSV dosyasına hazırlandı`);
    } catch (error) {
      notify(error.message, "error");
    }
  }
  return (
    <>
      <PageHeader
        title="Ürünler"
        description="Maliyet, kârlılık, buybox ve repricer durumunu tek listede yönetin"
        actions={<IconButton icon={RefreshCw} label="Yenile" onClick={load} />}
      />
      <div className="filters">
        <SearchInput
          value={filters.search}
          onChange={(search) => setFilters({ ...filters, search, page: 1 })}
          placeholder="Barkod veya ürün ara"
        />
        <input
          value={filters.brand}
          onChange={(e) =>
            setFilters({ ...filters, brand: e.target.value, page: 1 })
          }
          placeholder="Marka"
        />
        <input
          value={filters.category}
          onChange={(e) =>
            setFilters({ ...filters, category: e.target.value, page: 1 })
          }
          placeholder="Kategori adı veya ID"
        />
        <select
          value={filters.status}
          onChange={(e) =>
            setFilters({ ...filters, status: e.target.value, page: 1 })
          }
        >
          <option value="">Tüm durumlar</option>
          <option value="incomplete">Veri eksik</option>
          <option value="mapping_missing">Mapping eksik</option>
          <option value="cost_missing">Maliyet eksik</option>
          <option value="commission_missing">Komisyon eksik</option>
          <option value="shipping_missing">Kargo eksik</option>
          <option value="loss">Zararda</option>
          <option value="below_min">Minimum fiyat altı</option>
          <option value="buybox">Buybox bizde</option>
          <option value="outside_buybox">Buybox dışında</option>
        </select>
        <select
          value={filters.active}
          onChange={(e) =>
            setFilters({ ...filters, active: e.target.value, page: 1 })
          }
        >
          <option value="">Aktif / pasif</option>
          <option value="true">Aktif</option>
          <option value="false">Pasif</option>
        </select>
        <select
          value={filters.stocked}
          onChange={(e) =>
            setFilters({ ...filters, stocked: e.target.value, page: 1 })
          }
        >
          <option value="">Stok durumu</option>
          <option value="true">Stoklu</option>
          <option value="false">Stoksuz</option>
        </select>
        <select
          value={filters.autoUpdate}
          onChange={(e) =>
            setFilters({ ...filters, autoUpdate: e.target.value, page: 1 })
          }
        >
          <option value="">Tüm repricer modları</option>
          <option value="true">Auto update açık</option>
          <option value="false">Auto update kapalı</option>
        </select>
        <select
          value={filters.mode}
          onChange={(e) =>
            setFilters({ ...filters, mode: e.target.value, page: 1 })
          }
        >
          <option value="">Tüm çalışma modları</option>
          <option value="MANUAL">Manuel</option>
          <option value="MONITOR">Sadece izle</option>
          <option value="AUTOMATIC">Otomatik</option>
        </select>
      </div>
      <div className="panel table-panel">
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState error={error} retry={load} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={result.items}
              columnVisibilityKey="products"
              exportFileName="urunler"
              onExport={exportAll}
              onRowClick={open}
            />
            <Pagination
              page={result.page}
              total={result.total}
              limit={result.limit}
              onChange={(page) => setFilters({ ...filters, page })}
            />
          </>
        )}
      </div>
      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.product_name}
        wide
      >
        <div className="product-hero">
          <div>
            <span>{selected?.barcode}</span>
            <h3>
              {selected?.brand} · {selected?.category_name}
            </h3>
          </div>
          <Badge tone={toneFor(selected?.data_status)}>
            {selected?.data_status}
          </Badge>
        </div>
        {!detail ? (
          <Loading />
        ) : (
          <>
            <div className="metric-row">
              <div>
                <span>Mevcut fiyat</span>
                <b>{money(detail.my_price)}</b>
              </div>
              <div>
                <span>Minimum fiyat</span>
                <b>{money(detail.min_price)}</b>
              </div>
              <div>
                <span>Net kâr</span>
                <b>{money(detail.calculated_net_profit)}</b>
              </div>
              <div>
                <span>Buybox sırası</span>
                <b>{detail.rank || "-"}</b>
              </div>
            </div>
            <div className="tabs">
              <button
                className={tab === "cost" ? "active" : ""}
                onClick={() => setTab("cost")}
              >
                <Calculator />
                Maliyet
              </button>
              <button
                className={tab === "settings" ? "active" : ""}
                onClick={() => setTab("settings")}
              >
                <SlidersHorizontal />
                Repricer
              </button>
              <button
                className={tab === "history" ? "active" : ""}
                onClick={() => setTab("history")}
              >
                <History />
                Geçmiş
              </button>
            </div>
            {tab === "cost" && <CostBreakdown data={detail.breakdown} />}{" "}
            {tab === "settings" && (
              <SettingsForm
                detail={detail}
                setDetail={setDetail}
                save={save}
                saving={saving}
                notify={notify}
              />
            )}{" "}
            {tab === "history" && <HistoryPanel barcode={detail.barcode} />}
          </>
        )}
      </Drawer>
    </>
  );
}
function CostBreakdown({ data }) {
  const p = data.product;
  return (
    <div>
      <div className="formula">
        <strong>Minimum fiyat hesabı</strong>
        <code>
          ({money(p.calculated_product_cost)} +{" "}
          {money(p.calculated_shipping_cost)} + {money(p.packaging_cost)} +{" "}
          {money(p.service_fee)} + {money(p.target_profit)}) / (1 -{" "}
          {Number(p.commission_rate || 0)}/100) = {money(p.min_price)}
        </code>
      </div>
      <div className="breakdown-list">
        {[
          ["Ürün maliyeti", p.calculated_product_cost],
          ["Kargo (KDV dahil)", p.calculated_shipping_cost],
          ["Ambalaj", p.packaging_cost],
          ["Hizmet bedeli", p.service_fee],
          ["Hedef kâr", p.target_profit],
        ].map(([l, v]) => (
          <div key={l}>
            <span>{l}</span>
            <b>{money(v)}</b>
          </div>
        ))}
      </div>
      <h3>Mapping satırları</h3>
      {data.mappings.map((x) => (
        <div className="mapping-row" key={x.id}>
          <div>
            <strong>{x.item_name || x.cost_item_code}</strong>
            <small>
              {x.cost_item_code} · {x.quantity} adet
            </small>
          </div>
          <b>{money(x.line_cost)}</b>
          {x.orphan && <Badge tone="danger">Orphan</Badge>}
        </div>
      ))}
    </div>
  );
}
function SettingsForm({ detail, setDetail, save, saving, notify }) {
  const [manualPrice, setManualPrice] = useState(detail.my_price);
  const s = detail.settings || {
    strategy: "Manuel",
    mode: "MANUAL",
    auto_update: false,
    price_cut_tl: 0.1,
    max_increase_tl: 10,
    max_single_change_pct: 15,
    max_daily_change_pct: 15,
    minimum_profit_tl: 40,
    minimum_profit_pct: 0,
    minimum_margin_pct: 0,
    min_undercut_tl: 0.1,
    max_undercut_tl: 75,
    min_change_interval_minutes: 30,
    daily_action_limit: 3,
    buybox_max_age_minutes: 20,
    blacklisted: false,
    learning_enabled: true,
  };
  const update = (key, value) =>
    setDetail({ ...detail, settings: { ...s, [key]: value } });
  async function manual() {
    try {
      await post(`/api/products/${detail.barcode}/manual-price-action`, {
        price: Number(manualPrice),
      });
      notify("Manuel fiyat aksiyonu onaya gönderildi");
    } catch (e) {
      notify(e.message, "error");
    }
  }
  return (
    <div className="form-grid">
      <Field label="Çalışma modu">
        <select
          value={s.mode || "MANUAL"}
          onChange={(e) => update("mode", e.target.value)}
        >
          <option value="MANUAL">Manuel</option>
          <option value="MONITOR">Sadece izle</option>
          <option value="AUTOMATIC">Otomatik</option>
        </select>
      </Field>
      <Field label="Strateji">
        <select
          value={s.strategy || "Manuel"}
          onChange={(e) => update("strategy", e.target.value)}
        >
          {[
            "Manuel",
            "Sadece İzle",
            "Temkinli",
            "Normal",
            "Agresif",
            "Kâr Koru",
            "Buybox Odaklı",
            "Öğrenen Pilot",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </Field>
      {[
        ["price_cut_tl", "Fiyat kırma TL"],
        ["max_increase_tl", "Maksimum artış TL"],
        ["max_single_change_pct", "Tek işlem değişim limiti %"],
        ["max_daily_change_pct", "Maks. günlük değişim %"],
        ["minimum_profit_tl", "Minimum kâr TL"],
        ["minimum_profit_pct", "Minimum kâr %"],
        ["minimum_margin_pct", "Minimum marj %"],
        ["minimum_price", "Özel minimum fiyat"],
        ["maximum_price", "Maksimum fiyat"],
        ["min_undercut_tl", "Minimum fiyat kırma TL"],
        ["max_undercut_tl", "Maksimum fiyat kırma TL"],
        ["min_change_interval_minutes", "Bekleme süresi (dk)"],
        ["daily_action_limit", "Günlük aksiyon limiti"],
        ["buybox_max_age_minutes", "Buybox veri yaşı (dk)"],
      ].map(([key, label]) => (
        <Field key={key} label={label}>
          <input
            type="number"
            step="0.01"
            value={s[key] ?? ""}
            onChange={(e) =>
              update(key, e.target.value === "" ? null : Number(e.target.value))
            }
          />
        </Field>
      ))}
      <label className="toggle">
        <input
          type="checkbox"
          checked={Boolean(s.auto_update)}
          onChange={(e) => update("auto_update", e.target.checked)}
        />
        <span />
        Auto update
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={Boolean(s.learning_enabled)}
          onChange={(e) => update("learning_enabled", e.target.checked)}
        />
        <span />
        Öğrenmeye dahil
      </label>
      <label className="toggle toggle-danger">
        <input
          type="checkbox"
          checked={Boolean(s.blacklisted)}
          onChange={(e) => update("blacklisted", e.target.checked)}
        />
        <span />
        Kara liste
      </label>
      <div className="manual-price">
        <Field label="Manuel fiyat aksiyonu">
          <input
            type="number"
            step="0.01"
            value={manualPrice}
            onChange={(e) => setManualPrice(e.target.value)}
          />
        </Field>
        <Button variant="secondary" onClick={manual}>
          Onaya gönder
        </Button>
      </div>
      <div className="form-actions">
        <Button icon={Save} onClick={save} disabled={saving}>
          {saving ? "Kaydediliyor" : "Ayarları kaydet"}
        </Button>
      </div>
    </div>
  );
}
function HistoryPanel({ barcode }) {
  const [data, setData] = useState(null),
    [type, setType] = useState("repricer");
  useEffect(() => {
    Promise.all([
      get(`/api/products/${barcode}/price-history`),
      get(`/api/products/${barcode}/buybox-history`),
      get(`/api/products/${barcode}/repricer-history`),
    ]).then(([p, b, r]) =>
      setData({ price: p.items, buybox: b.items, repricer: r.items }),
    );
  }, [barcode]);
  if (!data) return <Loading />;
  const tabs = [
    ["repricer", "Repricer aksiyonları"],
    ["price", "Fiyat geçmişi"],
    ["buybox", "Buybox geçmişi"],
  ];
  return (
    <div>
      <div className="tabs history-tabs">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={type === key ? "active" : ""}
            onClick={() => setType(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="timeline">
        {type === "repricer" &&
          data.repricer.slice(0, 50).map((x) => (
            <div key={x.id}>
              <span />
              <section>
                <header>
                  <Badge tone={toneFor(x.status)}>{x.status}</Badge>
                  <time>{date(x.created_at)}</time>
                </header>
                <strong>
                  {x.action}: {money(x.old_price)} → {money(x.proposed_price)}
                </strong>
                <p>
                  {x.reason} · Hedef sıra: {x.target_rank || "-"}
                </p>
              </section>
            </div>
          ))}
        {type === "price" &&
          data.price.slice(0, 50).map((x) => (
            <div key={x.id}>
              <span />
              <section>
                <header>
                  <Badge tone="info">{x.action || "FİYAT"}</Badge>
                  <time>{date(x.created_at)}</time>
                </header>
                <strong>
                  {money(x.old_price)} → {money(x.new_price)}
                </strong>
                <p>Buybox: {money(x.buybox_price)}</p>
              </section>
            </div>
          ))}
        {type === "buybox" &&
          data.buybox.slice(0, 50).map((x) => (
            <div key={x.id}>
              <span />
              <section>
                <header>
                  <Badge tone={Number(x.rank) === 1 ? "success" : "warning"}>
                    {x.rank ? `${x.rank}. sıra` : "Sıra yok"}
                  </Badge>
                  <time>{date(x.observed_at)}</time>
                </header>
                <strong>
                  Biz: {money(x.observed_price)} · Buybox:{" "}
                  {money(x.buybox_price)}
                </strong>
                <p>
                  2. fiyat {money(x.second_price)} · 3. fiyat{" "}
                  {money(x.third_price)}
                </p>
              </section>
            </div>
          ))}
        {!data[type].length && (
          <div className="inline-warning">
            <ShieldAlert />
            Bu ürün için seçilen geçmiş türünde henüz kayıt yok.
          </div>
        )}
      </div>
    </div>
  );
}
