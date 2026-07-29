import React, { useEffect, useState } from "react";
import {
  Cable,
  CheckCircle2,
  CircleOff,
  Clock3,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { get, post } from "../lib/api";
import {
  Badge,
  Button,
  Drawer,
  Empty,
  ErrorState,
  Loading,
  PageHeader,
  toneFor,
  useRemote,
} from "../components/ui";

const capabilityLabels = {
  supportsCatalogSearch: "Katalog arama",
  supportsCatalogProductRead: "Katalog ürünü okuma",
  supportsExistingCatalogOfferCreate: "Mevcut kataloğa teklif",
  supportsNewProductCreate: "Yeni ürün oluşturma",
  supportsCategorySync: "Kategori senkronu",
  supportsAttributeSync: "Özellik senkronu",
  supportsBrandSync: "Marka senkronu",
  supportsCommissionApi: "Komisyon",
  supportsBuybox: "Buybox",
  supportsContentUpdate: "İçerik güncelleme",
  supportsImageUpdate: "Görsel güncelleme",
  supportsVideo: "Video",
  supportsOrders: "Siparişler",
  supportsFinancialTransactions: "Finans hareketleri",
  supportsPriceUpdate: "Fiyat güncelleme",
  supportsInventoryUpdate: "Stok güncelleme",
  supportsBatchStatus: "Batch sonucu",
  supportsListingVerification: "Listing doğrulama",
};

const syncFields = [
  ["last_category_sync_at", "Kategori"],
  ["last_brand_sync_at", "Marka"],
  ["last_product_sync_at", "Ürün"],
  ["last_buybox_sync_at", "Buybox"],
  ["last_finance_sync_at", "Finans"],
];

function dateTime(value) {
  return value ? new Date(value).toLocaleString("tr-TR") : "Henüz yok";
}

function adapterLabel(value) {
  return (
    {
      READY: "Hazır",
      WAITING_CREDENTIALS: "Kimlik bekliyor",
      DISABLED: "Devre dışı",
      SKELETON: "İskelet hazır",
    }[value] || value
  );
}

export default function Integrations({ notify }) {
  const remote = useRemote(() => get("/api/integrations"), []);
  const [selected, setSelected] = useState(null);
  const [testing, setTesting] = useState("");
  const [sitTests, setSitTests] = useState(null);
  const [sitPreview, setSitPreview] = useState(null);
  const [sitRunResult, setSitRunResult] = useState(null);
  const [sitLoading, setSitLoading] = useState(false);
  const [sitInput, setSitInput] = useState({
    merchantSku: "8660891646397",
    hbSku: "HBV000010LWPR",
    productName: "Aşlamacı ERP SIT Test Ürünü",
    price: "1000",
    stock: "20000",
    packageNumber: "",
    packageAction: "deliver_flow",
  });

  async function testConnection(item) {
    setTesting(item.code);
    try {
      const response = await post(`/api/integrations/${item.code}/test`);
      notify(response.message || "Bağlantı doğrulandı");
    } catch (error) {
      notify(error.message, "warning");
    } finally {
      setTesting("");
      remote.reload();
    }
  }

  async function loadSitTests() {
    setSitLoading(true);
    try {
      const response = await get("/api/integrations/hepsiburada/sit-tests");
      setSitTests(response.data);
    } catch (error) {
      notify(error.message, "warning");
    } finally {
      setSitLoading(false);
    }
  }

  async function previewSitStep(step) {
    setSitLoading(true);
    try {
      const response = await post(
        `/api/integrations/hepsiburada/sit-tests/${step}/preview`,
      );
      setSitPreview(response.data);
    } catch (error) {
      notify(error.message, "warning");
    } finally {
      setSitLoading(false);
    }
  }

  async function runSitStep(step) {
    setSitLoading(true);
    try {
      const response = await post(
        `/api/integrations/hepsiburada/sit-tests/${step}/run`,
        sitInput,
      );
      setSitRunResult(response.data);
      notify("Hepsiburada SIT adımı çalıştırıldı");
    } catch (error) {
      notify(error.message, "warning");
    } finally {
      setSitLoading(false);
    }
  }

  useEffect(() => {
    setSitTests(null);
    setSitPreview(null);
    setSitRunResult(null);
    if (selected?.code === "HEPSIBURADA") loadSitTests();
  }, [selected?.code]);

  if (remote.loading) return <Loading />;
  if (remote.error)
    return <ErrorState error={remote.error} retry={remote.reload} />;
  const items = remote.data?.items || [];

  return (
    <>
      <PageHeader
        title="Entegrasyonlar"
        description="Pazaryeri bağlantıları, yetenekler ve güvenli çalışma durumu"
        actions={<Badge tone="info">Pazaryerinden bağımsız</Badge>}
      />
      {!items.length ? (
        <Empty label="Pazaryeri kaydı bulunamadı" />
      ) : (
        <div className="integration-grid">
          {items.map((item) => {
            const supported = Object.values(item.capabilities || {}).filter(
              Boolean,
            ).length;
            return (
              <article className="integration-card" key={item.code}>
                <header>
                  <div className="integration-icon">
                    <Cable size={20} />
                  </div>
                  <div>
                    <h2>{item.display_name}</h2>
                    <small>{item.code}</small>
                  </div>
                  <Badge tone={item.enabled ? "success" : "neutral"}>
                    {item.enabled ? "Aktif" : "Pasif"}
                  </Badge>
                </header>
                <div className="integration-status-list">
                  <div>
                    <ShieldCheck size={17} />
                    <span>Adapter</span>
                    <Badge tone={toneFor(adapterLabel(item.adapter_status))}>
                      {adapterLabel(item.adapter_status)}
                    </Badge>
                  </div>
                  <div>
                    <KeyRound size={17} />
                    <span>Credential</span>
                    <Badge
                      tone={item.credentials_configured ? "success" : "warning"}
                    >
                      {item.credentials_configured ? "Yapılandırıldı" : "Eksik"}
                    </Badge>
                  </div>
                  <div>
                    <CheckCircle2 size={17} />
                    <span>Desteklenen yetenek</span>
                    <strong>{supported}</strong>
                  </div>
                  <div>
                    <Clock3 size={17} />
                    <span>Son başarılı bağlantı</span>
                    <strong>
                      {dateTime(item.last_successful_connection_at)}
                    </strong>
                  </div>
                </div>
                {item.last_error_summary && (
                  <div className="integration-warning">
                    <CircleOff size={17} />
                    <span>{item.last_error_summary}</span>
                  </div>
                )}
                <footer>
                  <Button variant="secondary" onClick={() => setSelected(item)}>
                    Detaylar
                  </Button>
                  <Button
                    icon={RefreshCw}
                    disabled={testing === item.code}
                    onClick={() => testConnection(item)}
                  >
                    {testing === item.code
                      ? "Test ediliyor"
                      : "Bağlantıyı test et"}
                  </Button>
                </footer>
              </article>
            );
          })}
        </div>
      )}
      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={`${selected?.display_name || "Pazaryeri"} entegrasyonu`}
        wide
      >
        {selected && (
          <div className="integration-detail">
            <section>
              <h3>Bağlantı durumu</h3>
              <dl className="detail-grid">
                <div>
                  <dt>Adapter</dt>
                  <dd>{adapterLabel(selected.adapter_status)}</dd>
                </div>
                <div>
                  <dt>Credential</dt>
                  <dd>
                    {selected.credentials_configured
                      ? "Yapılandırıldı"
                      : "Eksik"}
                  </dd>
                </div>
                <div>
                  <dt>Ortam</dt>
                  <dd>{selected.runtime?.environment || "Tanımsız"}</dd>
                </div>
                <div>
                  <dt>Mutasyon kilidi</dt>
                  <dd>
                    {selected.runtime?.mutationsEnabled ? "Açık" : "Kapalı"}
                  </dd>
                </div>
                <div>
                  <dt>Varsayılan kargo</dt>
                  <dd>{selected.default_carrier || "Tanımsız"}</dd>
                </div>
                <div>
                  <dt>Hizmet bedeli</dt>
                  <dd>
                    ₺
                    {(
                      Number(selected.default_service_fee_minor || 0) / 100
                    ).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                  </dd>
                </div>
                <div>
                  <dt>Para birimi</dt>
                  <dd>{selected.currency}</dd>
                </div>
                <div>
                  <dt>Saat dilimi</dt>
                  <dd>{selected.timezone}</dd>
                </div>
              </dl>
            </section>
            <section>
              <h3>Capability sözleşmesi</h3>
              <div className="capability-list">
                {Object.entries(selected.capabilities || {}).map(
                  ([key, value]) => (
                    <div key={key}>
                      {value ? (
                        <CheckCircle2 size={17} />
                      ) : (
                        <CircleOff size={17} />
                      )}
                      <span>{capabilityLabels[key] || key}</span>
                      <Badge tone={value ? "success" : "neutral"}>
                        {value ? "Destekleniyor" : "Kapalı"}
                      </Badge>
                    </div>
                  ),
                )}
              </div>
            </section>
            <section>
              <h3>Son senkronlar</h3>
              <dl className="detail-grid">
                {syncFields.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{dateTime(selected[key])}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {selected.code === "HEPSIBURADA" && (
              <section>
                <h3>Hepsiburada SIT test merkezi</h3>
                {!sitTests ? (
                  <Button
                    variant="secondary"
                    icon={RefreshCw}
                    disabled={sitLoading}
                    onClick={loadSitTests}
                  >
                    Test durumunu yükle
                  </Button>
                ) : (
                  <>
                    <dl className="detail-grid">
                      <div>
                        <dt>Ortam</dt>
                        <dd>{sitTests.safety?.environment}</dd>
                      </div>
                      <div>
                        <dt>SIT kilidi</dt>
                        <dd>{sitTests.safety?.sitOnly ? "Doğru" : "Eksik"}</dd>
                      </div>
                      <div>
                        <dt>Mutasyon kilidi</dt>
                        <dd>
                          {sitTests.safety?.mutationsLocked
                            ? "Kapalı ve güvenli"
                            : "Açık görünüyor"}
                        </dd>
                      </div>
                      <div>
                        <dt>Webhook URL</dt>
                        <dd>{sitTests.safety?.publicWebhookUrl || "Eksik"}</dd>
                      </div>
                    </dl>
                    {Boolean(sitTests.blockedReasons?.length) && (
                      <div className="integration-warning">
                        <CircleOff size={17} />
                        <span>{sitTests.blockedReasons.join(", ")}</span>
                      </div>
                    )}
                    <div className="detail-grid">
                      <label>
                        <dt>Satıcı stok kodu / Merchant SKU</dt>
                        <input
                          value={sitInput.merchantSku}
                          onChange={(event) =>
                            setSitInput((current) => ({
                              ...current,
                              merchantSku: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <dt>Hepsiburada SKU / Platform ID</dt>
                        <input
                          value={sitInput.hbSku}
                          onChange={(event) =>
                            setSitInput((current) => ({
                              ...current,
                              hbSku: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <dt>Test ürün adı</dt>
                        <input
                          value={sitInput.productName}
                          onChange={(event) =>
                            setSitInput((current) => ({
                              ...current,
                              productName: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <dt>Test fiyatı</dt>
                        <input
                          value={sitInput.price}
                          onChange={(event) =>
                            setSitInput((current) => ({
                              ...current,
                              price: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <dt>Test stoku</dt>
                        <input
                          value={sitInput.stock}
                          onChange={(event) =>
                            setSitInput((current) => ({
                              ...current,
                              stock: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <dt>Paket no</dt>
                        <input
                          placeholder="Boşsa ilk SIT paketi"
                          value={sitInput.packageNumber}
                          onChange={(event) =>
                            setSitInput((current) => ({
                              ...current,
                              packageNumber: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <dt>Paket statü akışı</dt>
                        <select
                          value={sitInput.packageAction}
                          onChange={(event) =>
                            setSitInput((current) => ({
                              ...current,
                              packageAction: event.target.value,
                            }))
                          }
                        >
                          <option value="deliver_flow">
                            Kargoda → teslim edildi
                          </option>
                          <option value="undeliver_flow">
                            Kargoda → teslim edilemedi
                          </option>
                          <option value="intransit">Sadece kargoda</option>
                          <option value="deliver">Sadece teslim edildi</option>
                          <option value="undeliver">
                            Sadece teslim edilemedi
                          </option>
                        </select>
                      </label>
                    </div>
                    <div className="capability-list">
                      {(sitTests.steps || []).map((step) => (
                        <div key={step.code}>
                          {step.status === "BLOCKED" ? (
                            <CircleOff size={17} />
                          ) : (
                            <CheckCircle2 size={17} />
                          )}
                          <span>
                            <strong>{step.title}</strong>
                            <small>{step.description}</small>
                          </span>
                          <Badge
                            tone={
                              step.status === "READY" ||
                              step.status === "DRY_RUN_READY"
                                ? "success"
                                : "warning"
                            }
                          >
                            {step.status}
                          </Badge>
                          <Button
                            variant="secondary"
                            disabled={sitLoading || step.status === "BLOCKED"}
                            onClick={() => previewSitStep(step.code)}
                          >
                            Önizle
                          </Button>
                          <Button
                            disabled={sitLoading || step.status === "BLOCKED"}
                            onClick={() => runSitStep(step.code)}
                          >
                            SIT'te çalıştır
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {sitPreview && (
                  <div className="integration-warning">
                    <ShieldCheck size={17} />
                    <span>
                      {sitPreview.message}
                      <pre>{JSON.stringify(sitPreview.preview, null, 2)}</pre>
                    </span>
                  </div>
                )}
                {sitRunResult && (
                  <div className="integration-warning">
                    <CheckCircle2 size={17} />
                    <span>
                      SIT sonucu
                      <pre>{JSON.stringify(sitRunResult, null, 2)}</pre>
                    </span>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
