import React, { useMemo, useState } from "react";
import { CheckCircle2, Lightbulb, SearchCheck, XCircle } from "lucide-react";
import { get, post } from "../lib/api";
import DataTable, { money } from "../components/DataTable";
import {
  Badge,
  Button,
  Confirm,
  Drawer,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  useRemote,
} from "../components/ui";

const types = [
  "MISSING_SINGLE",
  "MISSING_MARKETPLACE",
  "MISSING_PACK_SIZE",
  "MIXED_BUNDLE",
  "PROFITABLE_BUYBOX_GAP",
  "LOW_COMPETITION_GAP",
  "HIGH_MARGIN_VARIANT",
];
const statuses = [
  "GENERATED",
  "RECIPE_APPROVED",
  "CATALOG_SEARCHED",
  "CATALOG_MATCH_REVIEW",
  "CONTENT_READY",
  "LISTING_READY",
  "REJECTED",
];

function nameOf(item) {
  return (
    item.recipe_name || item.proposed_recipe?.recipeName || "İsimsiz fırsat"
  );
}

function maybeMoney(value) {
  return value == null ? "-" : money(value);
}

function Economics({ data = {} }) {
  return (
    <div className="metric-row opportunity-metrics">
      <div>
        <span>Ürün maliyeti</span>
        <strong>{maybeMoney(data.productCost)}</strong>
      </div>
      <div>
        <span>Desi</span>
        <strong>{data.desi ?? "-"}</strong>
      </div>
      <div>
        <span>Kargo</span>
        <strong>{maybeMoney(data.shippingCost)}</strong>
      </div>
      <div>
        <span>Komisyon</span>
        <strong>
          {data.commissionRate != null ? `%${data.commissionRate}` : "-"}
        </strong>
      </div>
      <div>
        <span>Minimum fiyat</span>
        <strong>{maybeMoney(data.minimumPrice)}</strong>
      </div>
      <div>
        <span>Buybox</span>
        <strong>{maybeMoney(data.buyboxPrice)}</strong>
      </div>
      <div>
        <span>Önerilen</span>
        <strong>{maybeMoney(data.proposedPrice)}</strong>
      </div>
      <div>
        <span>Net kâr</span>
        <strong>{maybeMoney(data.expectedNetProfit)}</strong>
      </div>
    </div>
  );
}

export default function OpportunityCenter({
  notify,
  marketplace = "TRENDYOL",
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(null);
  const [generateConfirm, setGenerateConfirm] = useState(false);
  const [approveConfirm, setApproveConfirm] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const query = useMemo(
    () =>
      `marketplace=${marketplace}&page=${page}&limit=50&search=${encodeURIComponent(search)}&type=${type}&status=${status}`,
    [marketplace, page, search, type, status],
  );
  const remote = useRemote(() => get(`/api/opportunities?${query}`), [query]);

  async function open(row) {
    const response = await get(`/api/opportunities/${row.id}`);
    setSelected(response.data);
  }
  async function generate() {
    const response = await post("/api/opportunities/generate", {
      targetMarketplace: marketplace,
      confirmation: "FIRSATLARI_URET",
    });
    setGenerateConfirm(false);
    notify(`${response.data.generated} açıklanabilir fırsat güncellendi`);
    remote.reload();
  }
  async function approve() {
    const response = await post(
      `/api/opportunities/${selected.id}/approve-recipe`,
      {
        confirmation: "FIRSAT_RECETESINI_ONAYLA",
      },
    );
    setSelected(response.data);
    setApproveConfirm(false);
    notify("Fırsat reçetesi onaylandı; otomatik yayın yapılmadı");
    remote.reload();
  }
  async function reject() {
    const response = await post(`/api/opportunities/${selected.id}/reject`, {
      reason: rejectReason,
      confirmation: "FIRSATI_REDDET",
    });
    setSelected(response.data);
    setRejecting(false);
    setRejectReason("");
    notify("Fırsat ret nedeni ve anlık skorla geçmişe kaydedildi");
    remote.reload();
  }
  async function searchCatalog() {
    const response = await post(
      `/api/opportunities/${selected.id}/catalog-search`,
      {},
    );
    setSelected(response.data.opportunity);
    notify(
      response.data.outcome?.message || "Katalog araması tamamlandı",
      response.data.outcome?.ok ? "success" : "warning",
    );
    remote.reload();
  }

  if (remote.loading) return <Loading />;
  if (remote.error)
    return <ErrorState error={remote.error} retry={remote.reload} />;
  const columns = [
    { key: "opportunity_type", label: "Fırsat", badge: true },
    { key: "name", label: "Ürün / reçete", render: nameOf },
    { key: "target_marketplace", label: "Hedef" },
    {
      key: "score",
      label: "Puan",
      render: (row) => `${Number(row.score).toFixed(1)} / 100`,
    },
    { key: "confidence", label: "Güven", badge: true },
    { key: "catalog_status", label: "Katalog", badge: true },
    {
      key: "cost",
      label: "Maliyet",
      render: (row) => maybeMoney(row.economics_json?.productCost),
    },
    {
      key: "minimum",
      label: "Min fiyat",
      render: (row) => maybeMoney(row.economics_json?.minimumPrice),
    },
    {
      key: "profit",
      label: "Net kâr",
      render: (row) => maybeMoney(row.economics_json?.expectedNetProfit),
    },
    { key: "workflow_status", label: "Durum", badge: true },
  ];
  return (
    <>
      <PageHeader
        title="Ürün Fırsatları"
        description="Eksik ürün, paket ve bundle fırsatlarını açıklanabilir sinyallerle inceleyin"
        actions={
          <Button icon={Lightbulb} onClick={() => setGenerateConfirm(true)}>
            Fırsatları üret
          </Button>
        }
      />
      <div className="context-band warning-band">
        <Badge tone="warning">İnsan onayı</Badge>
        <span>
          Fırsatlar reçete ve içerik hazırlayabilir; hiçbir ürün kendiliğinden
          yayınlanmaz.
        </span>
      </div>
      <div className="filters opportunity-filters">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Ürün veya reçete ara"
        />
        <select
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Tüm fırsat türleri</option>
          {types.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Tüm durumlar</option>
          {statuses.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <DataTable
        columns={columns}
        rows={remote.data.items}
        onRowClick={open}
        columnVisibilityKey="product-opportunities"
        exportFileName="urun-firsatlari"
      />
      <Pagination
        page={page}
        limit={remote.data.limit}
        total={remote.data.total}
        onChange={setPage}
      />
      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? nameOf(selected) : "Fırsat"}
        wide
      >
        {selected && (
          <div className="opportunity-detail">
            <div className="context-band">
              <Badge tone="info">{selected.opportunity_type}</Badge>
              <span>{selected.generation_reason}</span>
            </div>
            <div className="opportunity-score">
              <strong>{Number(selected.score).toFixed(1)}</strong>
              <span>/ 100</span>
              <Badge
                tone={
                  selected.confidence === "HIGH"
                    ? "success"
                    : selected.confidence === "INSUFFICIENT_DATA"
                      ? "danger"
                      : "warning"
                }
              >
                {selected.confidence}
              </Badge>
            </div>
            <Economics data={selected.economics_json} />
            <h3>Reçete bileşenleri</h3>
            {!selected.proposed_recipe?.components?.length ? (
              <Empty label="Mevcut PIM reçetesi kullanılıyor" />
            ) : (
              <div className="recipe-components">
                {selected.proposed_recipe.components.map((item) => (
                  <div key={item.costItemCode}>
                    <strong>{item.costItemCode}</strong>
                    <span>{item.quantity} adet</span>
                  </div>
                ))}
              </div>
            )}
            <h3>Puan katkıları</h3>
            {!selected.signal_breakdown?.length ? (
              <Empty label="Puanlamak için yeterli sinyal yok" />
            ) : (
              <div className="signal-list">
                {selected.signal_breakdown.map((item) => (
                  <div key={item.key}>
                    <span>
                      <strong>{item.label}</strong>
                      <small>
                        {item.source} · değer: {String(item.value)}
                      </small>
                    </span>
                    <b>+{item.contribution}</b>
                  </div>
                ))}
              </div>
            )}
            {selected.data_quality?.missing?.length > 0 && (
              <div className="inline-notice warning-band">
                <strong>Eksik veri</strong>
                <span>{selected.data_quality.missing.join(", ")}</span>
              </div>
            )}
            <h3>Katalog ve yayın</h3>
            <dl className="detail-grid">
              <div>
                <dt>Katalog durumu</dt>
                <dd>{selected.catalog_status}</dd>
              </div>
              <div>
                <dt>Listing barkodu</dt>
                <dd>
                  {selected.listing_barcode_required
                    ? "Gerekli"
                    : "Henüz tahsis edilmez"}
                </dd>
              </div>
              <div>
                <dt>Workflow</dt>
                <dd>{selected.workflow_status}</dd>
              </div>
              <div>
                <dt>Gerçek yayın</dt>
                <dd>Kapalı</dd>
              </div>
            </dl>
            {selected.events?.length > 0 && (
              <>
                <h3>Karar geçmişi</h3>
                <div className="signal-list">
                  {selected.events.map((item) => (
                    <div key={item.id}>
                      <span>
                        <strong>{item.event_type}</strong>
                        <small>{item.reason || item.actor || "Sistem"}</small>
                      </span>
                      <b>{item.to_status}</b>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="drawer-actions">
              <Button
                icon={SearchCheck}
                variant="secondary"
                onClick={searchCatalog}
              >
                Katalogda ara
              </Button>
              {!["RECIPE_APPROVED", "REJECTED", "PUBLISHED"].includes(
                selected.workflow_status,
              ) && (
                <Button
                  icon={CheckCircle2}
                  onClick={() => setApproveConfirm(true)}
                >
                  Reçeteyi onayla
                </Button>
              )}
              {!["REJECTED", "PUBLISHED"].includes(
                selected.workflow_status,
              ) && (
                <Button
                  icon={XCircle}
                  variant="danger"
                  onClick={() => setRejecting(true)}
                >
                  Reddet
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>
      <Confirm
        open={generateConfirm}
        onClose={() => setGenerateConfirm(false)}
        onConfirm={generate}
        title="Fırsatları yeniden üret"
        confirmLabel="Fırsatları üret"
        message={`${marketplace} için PIM, maliyet ve mevcut pazar verileri taranacak. Pazaryerine veri gönderilmeyecek.`}
      />
      <Confirm
        open={approveConfirm}
        onClose={() => setApproveConfirm(false)}
        onConfirm={approve}
        title="Fırsat reçetesini onayla"
        confirmLabel="Reçeteyi onayla"
        message="Önerilen bileşen ve adetler PIM reçetesi olarak onaylanacak. Ürün yayınlanmayacak ve barkod tüketilmeyecek."
      />
      <Modal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Fırsatı reddet"
      >
        <div className="modal-body">
          <Field
            label="Ret nedeni"
            hint="Karar, reçete ve anlık skor geçmişte korunur"
          >
            <textarea
              aria-label="Ret nedeni"
              rows="5"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </Field>
        </div>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setRejecting(false)}>
            Vazgeç
          </Button>
          <Button
            variant="danger"
            disabled={!rejectReason.trim()}
            onClick={reject}
          >
            Reddet
          </Button>
        </div>
      </Modal>
    </>
  );
}
