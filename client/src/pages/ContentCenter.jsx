import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  FileDiff,
  HeartPulse,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { get, patch, post } from "../lib/api";
import DataTable from "../components/DataTable";
import {
  Badge,
  Button,
  Confirm,
  Drawer,
  Empty,
  ErrorState,
  Field,
  Loading,
  PageHeader,
  Pagination,
  SearchInput,
  useRemote,
} from "../components/ui";

const healthLabels = {
  HIGH: "Yüksek",
  MEDIUM: "Orta",
  LOW: "Düşük",
  PASS: "Uygun",
  ISSUE: "Sorun",
  MISSING_DATA: "Veri eksik",
  conversion: "Dönüşüm verisi",
  conversionRate: "Dönüşüm oranı",
  returnRate: "İade oranı",
  customerQuestions: "Müşteri soruları",
};

function healthLabel(value) {
  return healthLabels[value] || value;
}

function ContentStudio({ notify, marketplace }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const query = useMemo(
    () =>
      `marketplace=${marketplace}&page=${page}&limit=50&search=${encodeURIComponent(search)}&status=${status}`,
    [marketplace, page, search, status],
  );
  const remote = useRemote(() => get(`/api/content-drafts?${query}`), [query]);

  async function open(row) {
    const response = await get(`/api/content-drafts/${row.id}`);
    setSelected(response.data);
    setEditing(response.data.proposed_content);
  }
  async function generate() {
    const response = await post("/api/content-drafts/generate", {
      recipeId: Number(recipeId),
      marketplace,
      confirmation: "ICERIK_TASLAGI_URET",
    });
    setConfirm(null);
    setRecipeId("");
    notify(
      `${response.data.provider.mode} içerik taslağı hazırlandı; dış çağrı yapılmadı`,
    );
    remote.reload();
  }
  async function save() {
    const response = await patch(`/api/content-drafts/${selected.id}`, {
      proposedContent: editing,
    });
    setSelected(response.data);
    setEditing(response.data.proposed_content);
    notify("İçerik değişikliği ve yeni snapshot kaydedildi");
    remote.reload();
  }
  async function approve() {
    const response = await post(`/api/content-drafts/${selected.id}/approve`, {
      confirmation: "ICERIGI_ONAYLA",
    });
    setSelected(response.data);
    setEditing(response.data.proposed_content);
    setConfirm(null);
    notify("İçerik insan onayı aldı; pazaryerine gönderilmedi");
    remote.reload();
  }
  async function dryRun() {
    const response = await post(
      `/api/content-drafts/${selected.id}/publish-dry-run`,
      { confirmation: "ICERIK_DRY_RUN_ONAYLA" },
    );
    setConfirm(null);
    notify(
      response.data.blockers.join(", ") || "Dry-run tamamlandı",
      "warning",
    );
  }
  async function rollback(snapshotId) {
    const response = await post(
      `/api/content-drafts/${selected.id}/rollback-preview`,
      { snapshotId, confirmation: "ROLLBACK_ONIZLE" },
    );
    setEditing(response.data.snapshot.content_json);
    notify(
      "Eski snapshot düzenleyiciye alındı; yeniden kaydetme ve onay gerekir",
      "warning",
    );
  }
  if (remote.loading) return <Loading />;
  if (remote.error)
    return <ErrorState error={remote.error} retry={remote.reload} />;
  const columns = [
    { key: "recipe_name", label: "Reçete" },
    { key: "marketplace", label: "Pazaryeri" },
    { key: "provider_mode", label: "Sağlayıcı", badge: true },
    { key: "workflow_status", label: "Durum", badge: true },
    {
      key: "errors",
      label: "Engel",
      render: (row) => row.safety_errors?.length || 0,
    },
    {
      key: "changes",
      label: "Değişiklik",
      render: (row) => row.diff_json?.length || 0,
    },
  ];
  return (
    <>
      <PageHeader
        title="İçerik Stüdyosu"
        description="Kaynak gerçeklerinden güvenli içerik taslağı, diff ve rollback hazırlayın"
      />
      <div className="context-band warning-band">
        <Badge tone="warning">Gönderim kapalı</Badge>
        <span>
          İçerik yalnız taslak ve dry-run olarak hazırlanır; canlı listing
          değişmez.
        </span>
      </div>
      <div className="content-generate-bar">
        <Field label="PIM reçete ID">
          <input
            aria-label="PIM reçete ID"
            value={recipeId}
            onChange={(event) => setRecipeId(event.target.value)}
            placeholder="Örn. 42"
            inputMode="numeric"
          />
        </Field>
        <Button
          icon={Sparkles}
          disabled={!Number(recipeId)}
          onClick={() => setConfirm("generate")}
        >
          Taslak üret
        </Button>
      </div>
      <div className="filters content-filters">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Reçete veya içerik ara"
        />
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Tüm durumlar</option>
          {["AI_DRAFT", "HUMAN_REVIEW", "APPROVED", "VERIFIED"].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <DataTable
        columns={columns}
        rows={remote.data.items}
        onRowClick={open}
        columnVisibilityKey="content-studio"
        exportFileName="icerik-taslaklari"
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
        title={selected?.recipe_name || "İçerik taslağı"}
        wide
      >
        {selected && editing && (
          <div className="content-detail">
            <div className="context-band">
              <Badge tone="info">{selected.provider_mode}</Badge>
              <span>{selected.workflow_status}</span>
              <Badge tone="warning">Canlı güncelleme kapalı</Badge>
            </div>
            {selected.safety_errors?.length > 0 && (
              <div className="inline-notice danger-band">
                <strong>Onay engelleri</strong>
                <span>{selected.safety_errors.join(", ")}</span>
              </div>
            )}
            {selected.safety_warnings?.length > 0 && (
              <div className="inline-notice warning-band">
                <strong>Uyarılar</strong>
                <span>{selected.safety_warnings.join(", ")}</span>
              </div>
            )}
            <div className="content-editor-grid">
              <section>
                <h3>Mevcut içerik</h3>
                <dl className="content-values">
                  <div>
                    <dt>Başlık</dt>
                    <dd>{selected.current_content?.title || "-"}</dd>
                  </div>
                  <div>
                    <dt>Açıklama</dt>
                    <dd>{selected.current_content?.description || "-"}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h3>Önerilen içerik</h3>
                <Field label="Başlık">
                  <input
                    aria-label="Önerilen başlık"
                    value={editing.title || ""}
                    onChange={(event) =>
                      setEditing({ ...editing, title: event.target.value })
                    }
                  />
                </Field>
                <Field label="Açıklama">
                  <textarea
                    aria-label="Önerilen açıklama"
                    rows="7"
                    value={editing.description || ""}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        description: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Arama terimleri">
                  <input
                    aria-label="Arama terimleri"
                    value={editing.searchTerms || ""}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        searchTerms: event.target.value,
                      })
                    }
                  />
                </Field>
              </section>
            </div>
            <h3>
              <FileDiff size={18} /> İçerik farkı
            </h3>
            {!selected.diff_json?.length ? (
              <Empty label="Fark bulunmuyor" />
            ) : (
              <div className="diff-list">
                {selected.diff_json.map((item) => (
                  <div key={item.field}>
                    <strong>{item.field}</strong>
                    <span>{String(item.current ?? "-")}</span>
                    <b>{String(item.proposed ?? "-")}</b>
                  </div>
                ))}
              </div>
            )}
            <h3>Görsel briefleri</h3>
            <div className="signal-list">
              {(editing.visualBriefs || []).map((item) => (
                <div key={item.type}>
                  <span>
                    <strong>{item.type}</strong>
                    <small>{item.brief}</small>
                  </span>
                </div>
              ))}
            </div>
            {selected.snapshots?.length > 0 && (
              <>
                <h3>Snapshot ve rollback</h3>
                <div className="snapshot-list">
                  {selected.snapshots.map((item) => (
                    <button key={item.id} onClick={() => rollback(item.id)}>
                      <RotateCcw size={16} />
                      <span>{item.snapshot_type}</span>
                      <small>
                        {new Date(item.created_at).toLocaleString("tr-TR")}
                      </small>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="drawer-actions">
              <Button variant="secondary" onClick={save}>
                Taslağı kaydet
              </Button>
              <Button icon={CheckCircle2} onClick={() => setConfirm("approve")}>
                İçeriği onayla
              </Button>
              {selected.workflow_status === "APPROVED" && (
                <Button
                  variant="secondary"
                  onClick={() => setConfirm("dry-run")}
                >
                  Gönderim dry-run
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>
      <Confirm
        open={confirm === "generate"}
        onClose={() => setConfirm(null)}
        onConfirm={generate}
        title="İçerik taslağı üret"
        confirmLabel="Taslak üret"
        message={`${marketplace} için yalnız PIM gerçekleri kullanılacak; dış AI veya pazaryeri çağrısı yapılmayacak.`}
      />
      <Confirm
        open={confirm === "approve"}
        onClose={() => setConfirm(null)}
        onConfirm={approve}
        title="İçeriği onayla"
        confirmLabel="Onayla"
        message="Görünen içerik ve paket adedi insan onayı alacak. Canlı listing değişmeyecek."
      />
      <Confirm
        open={confirm === "dry-run"}
        onClose={() => setConfirm(null)}
        onConfirm={dryRun}
        title="İçerik gönderim dry-run"
        confirmLabel="Dry-run yap"
        message="Capability ve credential kapıları önizlenecek; adapter mutasyonu yapılmayacak."
      />
    </>
  );
}

function ListingHealth({ notify, marketplace }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const query = useMemo(
    () =>
      `marketplace=${marketplace}&page=${page}&limit=50&search=${encodeURIComponent(search)}`,
    [marketplace, page, search],
  );
  const remote = useRemote(() => get(`/api/listing-health?${query}`), [query]);
  async function scan() {
    const response = await post("/api/listing-health/scan", {
      marketplace,
      confirmation: "LISTING_SAGLIGINI_TARA",
    });
    setConfirm(false);
    notify(
      `${response.data.successful} listing açıklanabilir kontrollerle tarandı`,
    );
    remote.reload();
  }
  async function open(row) {
    const response = await get(`/api/listing-health/${row.id}`);
    setSelected(response.data);
  }
  if (remote.loading) return <Loading />;
  if (remote.error)
    return <ErrorState error={remote.error} retry={remote.reload} />;
  const columns = [
    { key: "recipe_name", label: "Reçete" },
    { key: "title", label: "Listing başlığı" },
    { key: "seller_listing_barcode", label: "Barkod" },
    {
      key: "quality_score",
      label: "Kalite",
      render: (row) => `${Number(row.quality_score).toFixed(0)} / 100`,
    },
    { key: "confidence", label: "Güven", badge: true },
    {
      key: "issues",
      label: "Sorun",
      render: (row) =>
        row.checks_json?.filter((item) => item.status === "ISSUE").length || 0,
    },
    { key: "publication_state", label: "Yayın", badge: true },
  ];
  return (
    <>
      <PageHeader
        title="Listing Sağlığı"
        description="Gözlenen sorunları, kanıtı ve ölçülecek KPI'yı birlikte değerlendirin"
        actions={
          <Button icon={HeartPulse} onClick={() => setConfirm(true)}>
            Sağlığı tara
          </Button>
        }
      />
      <div className="context-band">
        <Badge tone="info">Açıklanabilir puan</Badge>
        <span>
          Puan algoritma sırası garantisi değildir; yalnız doğrulanabilen kalite
          ve operasyon sinyallerini gösterir.
        </span>
      </div>
      <div className="filters health-filters">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Başlık, reçete veya barkod ara"
        />
      </div>
      <DataTable
        columns={columns}
        rows={remote.data.items}
        onRowClick={open}
        columnVisibilityKey="listing-health"
        exportFileName="listing-sagligi"
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
        title={selected?.title || "Listing sağlığı"}
        wide
      >
        {selected && (
          <div className="health-detail">
            <div className="health-score">
              <strong>{Number(selected.quality_score).toFixed(0)}</strong>
              <span>/ 100</span>
              <Badge
                tone={
                  Number(selected.quality_score) >= 80
                    ? "success"
                    : Number(selected.quality_score) >= 60
                      ? "warning"
                      : "danger"
                }
              >
                {healthLabel(selected.confidence)}
              </Badge>
            </div>
            <p>{selected.summary}</p>
            <div className="health-checks">
              {selected.checks_json.map((item) => (
                <article
                  key={item.code}
                  className={`health-${item.status.toLowerCase()}`}
                >
                  <header>
                    <Badge
                      tone={
                        item.status === "PASS"
                          ? "success"
                          : item.status === "ISSUE"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {healthLabel(item.status)}
                    </Badge>
                    <strong>{item.label}</strong>
                    <span>{item.penalty ? `-${item.penalty}` : ""}</span>
                  </header>
                  <p>
                    {typeof item.evidence === "string"
                      ? item.evidence
                      : JSON.stringify(item.evidence)}
                  </p>
                  {item.recommendation && (
                    <>
                      <b>{item.recommendation}</b>
                      <small>
                        Beklenen etki: {item.expectedImpact}
                        <br />
                        Ölçülecek KPI: {item.kpi}
                      </small>
                    </>
                  )}
                </article>
              ))}
            </div>
            {selected.data_quality?.missing?.length > 0 && (
              <div className="inline-notice warning-band">
                <strong>Eksik veri</strong>
                <span>
                  {selected.data_quality.missing.map(healthLabel).join(", ")}
                </span>
              </div>
            )}
          </div>
        )}
      </Drawer>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={scan}
        title="Listing sağlığını tara"
        confirmLabel="Taramayı başlat"
        message={`${marketplace} listingleri okunacak ve puanları güncellenecek. Pazaryerine veri gönderilmeyecek.`}
      />
    </>
  );
}

export default function ContentCenter(props) {
  return props.mode === "listing-health" ? (
    <ListingHealth {...props} />
  ) : (
    <ContentStudio {...props} />
  );
}
