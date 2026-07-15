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
  Activity,
  Pencil,
} from "lucide-react";
import { get, post, patch } from "../lib/api";
import DataTable, {
  money,
  percent,
  date,
  downloadCsv,
} from "../components/DataTable";
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

const SAFETY_REASON_LABELS = {
  PRODUCT_INACTIVE: "Ürün aktif değil.",
  PRODUCT_NOT_ON_SALE: "Ürün satışta görünmüyor.",
  PRODUCT_LOCKED: "Ürün kilitli.",
  OUT_OF_STOCK: "Stok sıfır veya geçersiz.",
  COST_INCOMPLETE: "Maliyet verisi tamam değil.",
  COMMISSION_MISSING: "Komisyon oranı eksik.",
  MIN_PRICE_MISSING: "Minimum fiyat hesaplanamamış.",
  BELOW_MIN_PRICE: "Önerilen fiyat minimum fiyatın altında.",
  CURRENT_PRICE_INVALID: "Mevcut fiyat geçersiz.",
  BUYBOX_MISSING: "Buybox verisi eksik.",
  BUYBOX_STALE: "Buybox verisi izin verilen süreden eski.",
  SINGLE_CHANGE_LIMIT: "Tek işlem fiyat değişim limiti aşılırdı.",
  DAILY_CHANGE_LIMIT: "Günlük fiyat değişim limiti aşılırdı.",
  DAILY_ACTION_LIMIT: "Günlük aksiyon sayısı limiti dolmuş.",
  BLACKLISTED:
    "Üründe manuel fiyat kilidi aktif. Özel komisyon veya kampanya bitene kadar otomatik repricer devre dışı.",
  LEARNING_PAUSED: "Bu üründe öğrenme duraklatılmış.",
  AUTO_UPDATE_DISABLED: "Ürün auto update kapalı.",
  GLOBAL_REPRICER_DISABLED: "Global repricer kapalı.",
  DRY_RUN: "Dry-run açık; gerçek fiyat gönderimi yapılmaz.",
  CHANGE_TOO_SMALL: "Fiyat değişimi anlamlı minimum tutarın altında.",
  LOSS_MAKING_DECREASE: "Zarardaki üründe otomatik düşüş yasak.",
  EXPECTED_LOSS: "Öneri sonrası beklenen kâr negatif.",
  MAX_INCREASE_LIMIT: "Maksimum artış TL limiti aşılırdı.",
  MIN_PROFIT_TL_VIOLATION: "Minimum kâr TL şartı sağlanmıyor.",
  MIN_PROFIT_PCT_VIOLATION: "Minimum kâr yüzdesi şartı sağlanmıyor.",
  MIN_MARGIN_VIOLATION: "Minimum marj şartı sağlanmıyor.",
  ABOVE_MAX_PRICE: "Önerilen fiyat maksimum fiyatın üstünde.",
  BELOW_MIN_DECREASE: "Fiyat düşüşü minimum fiyat sınırını zorlar.",
  COOLDOWN_ACTIVE: "İki fiyat aksiyonu arası bekleme süresi dolmamış.",
};

function safetyReasonText(code) {
  return SAFETY_REASON_LABELS[code] || code;
}

function formatSignedMoney(value) {
  const number = Number(value || 0);
  const formatted = money(number);
  return number > 0 ? `+${formatted}` : formatted;
}

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
      {mode === "buybox" && <Buybox key={refresh} notify={notify} />}{" "}
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
function Buybox({ notify }) {
  const [payload, setPayload] = useState(null),
    [filters, setFilters] = useState({
      search: "",
      status: "",
      active: "",
      stocked: "",
      autoUpdate: "",
      mode: "",
      category: "",
      brand: "",
      page: 1,
    }),
    [error, setError] = useState(null),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const id = setTimeout(
      () => {
        const query = new URLSearchParams(
          Object.entries({ ...filters, limit: 100 }).filter(
            ([, value]) => value !== "",
          ),
        );
        get(`/api/buybox?${query}`).then(setPayload).catch(setError);
      },
      filters.search ? 250 : 0,
    );
    return () => clearTimeout(id);
  }, [filters, reload]);
  async function exportAll(columns) {
    try {
      const limit = 1000;
      const query = new URLSearchParams(
        Object.entries({ ...filters, page: 1, limit }).filter(
          ([, value]) => value !== "",
        ),
      );
      const first = await get(`/api/buybox?${query}`);
      const items = [...first.items];
      const pages = Math.ceil(first.total / limit);
      for (let nextPage = 2; nextPage <= pages; nextPage++) {
        query.set("page", nextPage);
        items.push(...(await get(`/api/buybox?${query}`)).items);
      }
      downloadCsv(columns, items, "buybox");
      notify(`${items.length} buybox kaydı CSV dosyasına hazırlandı`);
    } catch (exportError) {
      notify(exportError.message, "error");
    }
  }
  if (error)
    return (
      <ErrorState
        error={error}
        retry={() => {
          setError(null);
          setReload((value) => value + 1);
        }}
      />
    );
  if (!payload) return <Loading />;
  return (
    <BuyboxTable
      payload={payload}
      filters={filters}
      setFilters={setFilters}
      onExport={exportAll}
    />
  );
}
function BuyboxTable({ payload, filters, setFilters, onExport }) {
  const [selected, setSelected] = useState(null);
  const [previewDetail, setPreviewDetail] = useState(null);
  const updateFilter = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const openPreviewDetail = (event, row) => {
    event.stopPropagation();
    setPreviewDetail(buyboxPreviewDetail(row));
  };
  const cols = [
    {
      key: "product_image_url",
      label: "Görsel",
      width: 62,
      sortable: false,
      exportable: false,
      render: (r) => <ProductThumb product={r} />,
    },
    { key: "barcode", label: "Barkod" },
    { key: "product_name", label: "Ürün" },
    { key: "strategy", label: "Öğrenilen strateji" },
    {
      key: "commission_rate",
      label: "Komisyon",
      render: (r) => percent(r.commission_rate),
    },
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
    { key: "preview_action", label: "Anlık aksiyon", badge: true },
    {
      key: "preview_proposed_price",
      label: "Anlık öneri",
      render: (r) =>
        r.preview_proposed_price == null
          ? "-"
          : money(r.preview_proposed_price),
    },
    {
      key: "preview_difference",
      label: "Fark",
      render: (r) => formatSignedMoney(r.preview_difference),
    },
    {
      key: "preview_blocked_reasons",
      label: "Engel",
      render: (r) =>
        r.preview_blocked_reasons?.length ? (
          <button
            type="button"
            className="badge-button"
            title={r.preview_blocked_reasons.map(safetyReasonText).join("\n")}
            onClick={(event) => openPreviewDetail(event, r)}
          >
            <Badge tone="danger">
              {r.preview_blocked_reasons.length} engel
            </Badge>
          </button>
        ) : (
          <button
            type="button"
            className="badge-button"
            title="Güvenlik detayını aç"
            onClick={(event) => openPreviewDetail(event, r)}
          >
            <Badge tone="success">Uygun</Badge>
          </button>
        ),
    },
    {
      key: "preview_reason",
      label: "Neden",
      render: (r) => (
        <button
          type="button"
          title={r.preview_reason}
          className="link-cell"
          onClick={(event) => openPreviewDetail(event, r)}
        >
          {r.preview_reason || "-"}
        </button>
      ),
    },
  ];
  return (
    <>
      <div className="filters">
        <SearchInput
          value={filters.search}
          onChange={(value) => updateFilter("search", value)}
          placeholder="Barkod veya ürün ara"
        />
        <input
          value={filters.brand}
          onChange={(event) => updateFilter("brand", event.target.value)}
          placeholder="Marka"
        />
        <input
          value={filters.category}
          onChange={(event) => updateFilter("category", event.target.value)}
          placeholder="Kategori adı veya ID"
        />
        <select
          value={filters.status}
          onChange={(event) => updateFilter("status", event.target.value)}
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
          <option value="outside_buybox">Buybox değil</option>
        </select>
        <select
          value={filters.active}
          onChange={(event) => updateFilter("active", event.target.value)}
        >
          <option value="">Aktif / pasif</option>
          <option value="true">Aktif</option>
          <option value="false">Pasif</option>
        </select>
        <select
          value={filters.stocked}
          onChange={(event) => updateFilter("stocked", event.target.value)}
        >
          <option value="">Stok durumu</option>
          <option value="true">Stoklu</option>
          <option value="false">Stoksuz</option>
        </select>
        <select
          value={filters.autoUpdate}
          onChange={(event) => updateFilter("autoUpdate", event.target.value)}
        >
          <option value="">Auto update</option>
          <option value="true">Açık</option>
          <option value="false">Kapalı</option>
        </select>
        <select
          value={filters.mode}
          onChange={(event) => updateFilter("mode", event.target.value)}
        >
          <option value="">Tüm çalışma modları</option>
          <option value="MANUAL">Manuel</option>
          <option value="MONITOR">Sadece izle</option>
          <option value="AUTOMATIC">Otomatik</option>
        </select>
      </div>
      <div className="panel table-panel">
        <DataTable
          columns={cols}
          rows={payload.items}
          onRowClick={setSelected}
          columnVisibilityKey="buybox"
          onExport={onExport}
        />
        <Pagination
          page={payload.page}
          total={payload.total}
          limit={payload.limit}
          onChange={(page) => setFilters((current) => ({ ...current, page }))}
        />
      </div>
      <BuyboxHistory product={selected} onClose={() => setSelected(null)} />
      <RepricerPreviewDetail
        item={previewDetail}
        onClose={() => setPreviewDetail(null)}
      />
    </>
  );
}

function ProductThumb({ product }) {
  const [failed, setFailed] = useState(false);
  const src = product?.product_image_url
    ? `/api/products/${encodeURIComponent(product.barcode)}/image`
    : null;
  useEffect(() => setFailed(false), [src]);
  if (!src || failed)
    return <span className="product-thumb product-thumb-empty">-</span>;
  return (
    <img
      className="product-thumb"
      src={src}
      alt={product.product_name || "Ürün görseli"}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function buyboxPreviewDetail(row) {
  return {
    barcode: row.barcode,
    productName: row.product_name,
    oldPrice: row.my_price,
    proposedPrice: row.preview_proposed_price,
    difference: row.preview_difference,
    expectedProfit: row.preview_expected_profit,
    action: row.preview_action,
    strategy: row.strategy,
    rank: row.rank,
    targetRank: row.preview_target_rank,
    reason: row.preview_reason,
    minPrice: row.min_price,
    maxPrice: row.maximum_price,
    buyboxPrice: row.buybox_price,
    secondPrice: row.second_price,
    thirdPrice: row.third_price,
    effectiveUndercut: row.preview_effective_undercut,
    learnedUndercut: row.learned_price_cut_tl,
    confidence: row.confidence_score,
    blockedReasons: row.preview_blocked_reasons || [],
  };
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
    [selectedPreview, setSelectedPreview] = useState(null),
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
    {
      key: "reason",
      label: "Neden",
      render: (r) => (
        <button
          type="button"
          className="link-cell"
          title={r.reason}
          onClick={(event) => {
            event.stopPropagation();
            setSelectedPreview(r);
          }}
        >
          {r.reason}
        </button>
      ),
    },
    {
      key: "blockedReasons",
      label: "Güvenlik",
      render: (r) =>
        r.blockedReasons.length ? (
          <button
            type="button"
            className="badge-button"
            title={r.blockedReasons.map(safetyReasonText).join("\n")}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedPreview(r);
            }}
          >
            <Badge tone="danger">{r.blockedReasons.length} engel</Badge>
          </button>
        ) : (
          <Badge tone="success">Güvenli</Badge>
        ),
    },
    {
      key: "ops",
      label: "Detay",
      sortable: false,
      exportable: false,
      render: (r) => (
        <IconButton
          icon={Eye}
          label="Karar detayını aç"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedPreview(r);
          }}
        />
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
              onRowClick={setSelectedPreview}
              columnVisibilityKey="repricer-preview"
            />
          </div>
        )
      )}
      <RepricerPreviewDetail
        item={selectedPreview}
        onClose={() => setSelectedPreview(null)}
      />
    </>
  );
}

function RepricerPreviewDetail({ item, onClose }) {
  if (!item) return null;
  const blockedReasons = item.blockedReasons || [];
  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={`${item.barcode} repricer önizleme detayı`}
    >
      <div className="preview-detail">
        <div className="metric-row">
          <div>
            <span>Mevcut fiyat</span>
            <b>{money(item.oldPrice)}</b>
          </div>
          <div>
            <span>Önerilen fiyat</span>
            <b>{money(item.proposedPrice)}</b>
          </div>
          <div>
            <span>Fark</span>
            <b>{formatSignedMoney(item.difference)}</b>
          </div>
          <div>
            <span>Beklenen kâr</span>
            <b>{money(item.expectedProfit)}</b>
          </div>
        </div>
        <div className="metric-row">
          <div>
            <span>Aksiyon</span>
            <b>{item.action}</b>
          </div>
          <div>
            <span>Strateji</span>
            <b>{item.strategy || "-"}</b>
          </div>
          <div>
            <span>Mevcut sıra</span>
            <b>{item.rank || "-"}</b>
          </div>
          <div>
            <span>Hedef sıra</span>
            <b>{item.targetRank || "-"}</b>
          </div>
        </div>
        <section>
          <h3>Karar nedeni</h3>
          <p className="reason-full">{item.reason || "-"}</p>
        </section>
        <section>
          <h3>Fiyat bağlamı</h3>
          <div className="compact-kv">
            <span>Minimum fiyat</span>
            <b>{money(item.minPrice)}</b>
            <span>Maksimum fiyat</span>
            <b>{item.maxPrice ? money(item.maxPrice) : "-"}</b>
            <span>Buybox fiyatı</span>
            <b>{money(item.buyboxPrice)}</b>
            <span>2. fiyat</span>
            <b>{money(item.secondPrice)}</b>
            <span>3. fiyat</span>
            <b>{money(item.thirdPrice)}</b>
            <span>Etkin fiyat kırma</span>
            <b>{money(item.effectiveUndercut)}</b>
            <span>Öğrenilmiş kırma</span>
            <b>{money(item.learnedUndercut)}</b>
            <span>Güven skoru</span>
            <b>{percent(item.confidence)}</b>
          </div>
        </section>
        <section>
          <h3>Güvenlik durumu</h3>
          {blockedReasons.length ? (
            <div className="safety-list">
              {blockedReasons.map((reason) => (
                <div key={reason}>
                  <Badge tone="danger">{reason}</Badge>
                  <p>{safetyReasonText(reason)}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="safety-list">
              <div>
                <Badge tone="success">Güvenli</Badge>
                <p>Bu önizlemede bloklayıcı güvenlik engeli görünmüyor.</p>
              </div>
            </div>
          )}
        </section>
        <p className="muted-note">
          Önizleme fiyat göndermez. Aksiyon oluşturulsa bile uygulama anında
          dry-run, minimum fiyat, buybox güncelliği, pazar fiyatı doğrulaması ve
          günlük limitler yeniden kontrol edilir.
        </p>
      </div>
    </Drawer>
  );
}
function Actions({ notify }) {
  const [data, setData] = useState(null),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [confirm, setConfirm] = useState(null),
    [selected, setSelected] = useState([]),
    [editing, setEditing] = useState(null);
  async function load() {
    const query = new URLSearchParams({ page, limit: 50 });
    if (status) query.set("status", status);
    setData(await get(`/api/actions?${query}`));
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
  }, [status, page]);
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
  async function exportAll(columns) {
    try {
      const limit = 200;
      const query = new URLSearchParams({ page: 1, limit });
      if (status) query.set("status", status);
      const first = await get(`/api/actions?${query}`);
      const items = [...first.items];
      const pages = Math.ceil(first.total / limit);
      for (let nextPage = 2; nextPage <= pages; nextPage++) {
        query.set("page", nextPage);
        items.push(...(await get(`/api/actions?${query}`)).items);
      }
      downloadCsv(columns, items, "fiyat-aksiyonlari");
      notify(`${items.length} fiyat aksiyonu CSV dosyasına hazırlandı`);
    } catch (exportError) {
      notify(exportError.message, "error");
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
    {
      key: "display_status",
      label: "Durum",
      render: (r) => (
        <Badge tone={toneFor(r.display_status || r.status)}>
          {r.display_status || r.status}
        </Badge>
      ),
    },
    { key: "outcome_result", label: "Sonuç", badge: true },
    { key: "outcome_elapsed_minutes", label: "Sonuç kontrolü (dk)" },
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
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tüm durumlar</option>
          {[
            "PENDING",
            "APPROVED",
            "DRY_RUN",
            "SENDING",
            "AWAITING_RESULT",
            "SUCCESS",
            "FAILED",
            "REJECTED",
            "EXPIRED",
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
          onExport={exportAll}
        />
        <Pagination
          page={data.page || page}
          total={data.total ?? data.items.length}
          limit={data.limit || 50}
          onChange={setPage}
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
  const [rows, setRows] = useState(data.items),
    [selected, setSelected] = useState(null),
    [detail, setDetail] = useState(null);
  async function open(row) {
    setSelected(row);
    setDetail(null);
    try {
      setDetail((await get(`/api/learning/${row.barcode}`)).data);
    } catch (error) {
      notify(error.message, "error");
    }
  }
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
    { key: "strategy", label: "Strateji" },
    {
      key: "last_required_gap_tl",
      label: "Son denenen kırma",
      render: (r) => money(r.last_required_gap_tl),
    },
    { key: "outcome_count", label: "Ölçülen sonuç" },
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
        <div
          className="row-actions"
          onClick={(event) => event.stopPropagation()}
        >
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
    <>
      <div className="panel table-panel">
        <DataTable
          columns={cols}
          rows={rows}
          columnVisibilityKey="learning"
          onRowClick={open}
        />
      </div>
      <Drawer
        open={Boolean(selected)}
        onClose={() => {
          setSelected(null);
          setDetail(null);
        }}
        title={selected ? `${selected.barcode} öğrenme geçmişi` : "Öğrenme"}
        wide
      >
        {!detail ? <Loading /> : <LearningDetail data={detail} />}
      </Drawer>
    </>
  );
}

function LearningDetail({ data }) {
  const learning = data.learning || {};
  const scores = Object.entries(learning.strategy_scores || {}).sort(
    ([, left], [, right]) => Number(right.score) - Number(left.score),
  );
  return (
    <div className="detail-stack">
      <div className="metric-row">
        <div>
          <span>Öğrenilen kırma</span>
          <b>{money(learning.learned_price_cut_tl)}</b>
        </div>
        <div>
          <span>Güven skoru</span>
          <b>{percent(Number(learning.confidence_score || 0) * 100)}</b>
        </div>
        <div>
          <span>Başarılı / başarısız</span>
          <b>
            {learning.success_attempts || 0} / {learning.failed_attempts || 0}
          </b>
        </div>
        <div>
          <span>Buybox kazanma süresi</span>
          <b>
            {data.attempts.find((item) => item.result === "BUYBOX_WON")
              ?.elapsed_minutes || "-"}{" "}
            dk
          </b>
        </div>
      </div>
      <div className="info-banner">
        <Activity />
        <div>
          <strong>Önerilen sonraki adım</strong>
          <p>{data.nextRecommendation}</p>
        </div>
      </div>
      {scores.length > 0 && (
        <section>
          <h3>Strateji başarı puanları</h3>
          <div className="strategy-score-list">
            {scores.map(([name, score]) => (
              <div key={name}>
                <span>{name}</span>
                <b>{percent(Number(score.score || 0) * 100)}</b>
                <small>{score.attempts || 0} deneme</small>
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3>Son fiyat denemeleri</h3>
        <DataTable
          columns={[
            {
              key: "created_at",
              label: "Tarih",
              render: (r) => date(r.created_at),
            },
            { key: "action", label: "Aksiyon", badge: true },
            {
              key: "old_price",
              label: "Eski",
              render: (r) => money(r.old_price),
            },
            {
              key: "proposed_price",
              label: "Önerilen",
              render: (r) => money(r.proposed_price),
            },
            {
              key: "attempted_undercut",
              label: "Denenen kırma",
              render: (r) => money(r.attempted_undercut),
            },
            { key: "result", label: "Sonuç", badge: true },
            { key: "elapsed_minutes", label: "Kontrol (dk)" },
            { key: "reason", label: "Neden" },
          ]}
          rows={data.attempts || []}
          columnVisibilityKey="learning-attempts"
          exportFileName={`ogrenme-${learning.barcode || "urun"}`}
        />
      </section>
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
