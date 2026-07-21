import React, { useState } from "react";
import { Eye, PackageCheck, Send, Shuffle } from "lucide-react";
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
  useRemote,
} from "../components/ui";

const marketplaces = ["TRENDYOL", "HEPSIBURADA", "PAZARAMA", "IDEFIX", "N11", "PTTAVM"];

function Pricing({ data }) {
  if (!data) return null;
  return (
    <div className="metric-row publishing-metrics">
      <div><span>Ürün maliyeti</span><strong>{money(data.productCost)}</strong></div>
      <div><span>Kargo</span><strong>{money(data.shippingCost)}</strong></div>
      <div><span>Ambalaj</span><strong>{money(data.packagingCost)}</strong></div>
      <div><span>Hizmet</span><strong>{money(data.serviceFee)}</strong></div>
      <div><span>Minimum fiyat</span><strong>{money(data.minimumPrice)}</strong></div>
      <div><span>Önerilen</span><strong>{money(data.proposedPrice)}</strong></div>
      <div><span>Hedef sıra</span><strong>{data.rankRecommendation?.targetRank || "Ekonomik değil"}</strong></div>
      <div><span>Beklenen net kâr</span><strong>{money(data.expectedNetProfit)}</strong></div>
    </div>
  );
}

function Blockers({ items = [] }) {
  if (!items.length)
    return <div className="inline-notice success"><strong>Doğrulama tamam</strong><span>Taslak yerel kontrollerden geçti.</span></div>;
  return <div className="blocker-list">{items.map((item) => <Badge key={item} tone="danger">{item}</Badge>)}</div>;
}

function Publishing({ notify }) {
  const remote = useRemote(() => get("/api/publication-drafts"), []);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [form, setForm] = useState({
    recipeId: "", sourceMarketplace: "TRENDYOL", targetMarketplace: "HEPSIBURADA",
    targetCategoryId: "", targetBrandId: "", stock: 1, title: "", description: "",
    attributesText: "{}", imagesText: "",
  });
  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const payload = () => {
    let attributes;
    try {
      attributes = JSON.parse(form.attributesText || "{}");
    } catch {
      throw new Error("Özellikler geçerli bir JSON nesnesi olmalı");
    }
    if (!attributes || Array.isArray(attributes) || typeof attributes !== "object")
      throw new Error("Özellikler geçerli bir JSON nesnesi olmalı");
    return {
      recipeId: Number(form.recipeId),
      sourceMarketplace: form.sourceMarketplace,
      targetMarketplace: form.targetMarketplace,
      stock: Number(form.stock),
      targetCategoryId: form.targetCategoryId || undefined,
      targetBrandId: form.targetBrandId || undefined,
      title: form.title || undefined,
      description: form.description || undefined,
      attributes,
      images: form.imagesText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    };
  };
  async function prepare() {
    const response = await post("/api/publication-drafts/preview", payload());
    setPreview(response.data);
  }
  async function save() {
    await post("/api/publication-drafts", payload());
    notify("Yayın taslağı dry-run olarak kaydedildi");
    setOpen(false);
    setPreview(null);
    remote.reload();
  }
  async function runDry() {
    const response = await post(`/api/publication-drafts/${confirm.id}/publish-dry-run`, {
      confirmation: "YAYIN_DRY_RUN_ONAYLA",
    });
    notify("Dry-run tamamlandı; pazaryerinde değişiklik yapılmadı");
    setConfirm(null);
    setSelected(response.data.draft);
    remote.reload();
  }
  if (remote.loading) return <Loading />;
  if (remote.error) return <ErrorState error={remote.error} retry={remote.reload} />;
  const columns = [
    { key: "recipe_name", label: "Reçete" },
    { key: "source_marketplace", label: "Kaynak" },
    { key: "target_marketplace", label: "Hedef" },
    { key: "publication_mode", label: "Yayın tipi", badge: true },
    { key: "workflow_status", label: "Durum", badge: true },
    { key: "target_category_id", label: "Kategori" },
    { key: "seller_listing_barcode", label: "Listing barkodu" },
    { key: "validation_errors", label: "Engel", render: (row) => `${row.validation_errors?.length || 0} engel` },
  ];
  return (
    <>
      <PageHeader title="Ürün Yayınlama" description="Katalog eşleşmesi, içerik ve fiyatı gönderimden önce doğrulayın" actions={<Button icon={Send} onClick={() => setOpen(true)}>Yeni taslak</Button>} />
      <div className="context-band warning-band"><Badge tone="warning">Yalnız dry-run</Badge><span>Bu ekrandan gerçek ürün, fiyat, stok veya içerik gönderilemez.</span></div>
      <DataTable columns={columns} rows={remote.data.items} onRowClick={setSelected} columnVisibilityKey="publication-drafts" exportFileName="urun-yayinlama-taslaklari" />
      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.recipe_name || "Yayın taslağı"} wide>
        {selected && <div className="publishing-detail">
          <div className="context-band"><Badge tone="info">{selected.target_marketplace}</Badge><span>{selected.publication_mode}</span></div>
          <Pricing data={selected.pricing_preview} />
          <h3>Güvenlik ve doğrulama</h3>
          <Blockers items={selected.validation_errors} />
          <h3>Gönderilecek içerik</h3>
          <dl className="detail-grid">
            <div><dt>Başlık</dt><dd>{selected.title || "-"}</dd></div>
            <div><dt>Kategori</dt><dd>{selected.target_category_id || "-"}</dd></div>
            <div><dt>Marka</dt><dd>{selected.target_brand_id || "-"}</dd></div>
            <div><dt>Stok</dt><dd>{selected.stock}</dd></div>
            <div><dt>Özellik</dt><dd>{Object.keys(selected.attributes || {}).length}</dd></div>
            <div><dt>Görsel</dt><dd>{selected.images?.length || 0}</dd></div>
          </dl>
          <div className="drawer-actions"><Button icon={Eye} variant="secondary" onClick={() => setConfirm(selected)}>Dry-run çalıştır</Button></div>
        </div>}
      </Drawer>
      <Modal open={open} onClose={() => setOpen(false)} title="Yayın taslağı oluştur">
        <div className="modal-body form-grid two-col">
          <Field label="Reçete ID"><input type="number" min="1" value={form.recipeId} onChange={change("recipeId")} /></Field>
          <Field label="Stok"><input type="number" min="0" value={form.stock} onChange={change("stock")} /></Field>
          <Field label="Kaynak pazaryeri"><select value={form.sourceMarketplace} onChange={change("sourceMarketplace")}>{marketplaces.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Hedef pazaryeri"><select value={form.targetMarketplace} onChange={change("targetMarketplace")}>{marketplaces.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Hedef kategori ID"><input value={form.targetCategoryId} onChange={change("targetCategoryId")} /></Field>
          <Field label="Hedef marka ID"><input value={form.targetBrandId} onChange={change("targetBrandId")} /></Field>
          <Field label="Başlık"><input value={form.title} onChange={change("title")} /></Field>
          <Field label="Açıklama"><textarea rows="3" value={form.description} onChange={change("description")} /></Field>
          <Field label="Özellikler" hint='JSON nesnesi, örn. {"renk":"Mor"}'><textarea rows="5" value={form.attributesText} onChange={change("attributesText")} /></Field>
          <Field label="Görseller" hint="Her satıra bir HTTPS görsel adresi"><textarea rows="5" value={form.imagesText} onChange={change("imagesText")} /></Field>
        </div>
        {preview && <div className="modal-body preview-panel"><Pricing data={preview.pricing} /><Blockers items={preview.blockers} /></div>}
        <div className="modal-actions">
          <Button variant="secondary" icon={Eye} disabled={!form.recipeId || form.sourceMarketplace === form.targetMarketplace} onClick={prepare}>Önizle</Button>
          <Button icon={PackageCheck} disabled={!preview} onClick={save}>Taslağı kaydet</Button>
        </div>
      </Modal>
      <Confirm open={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={runDry} title="Yayın dry-run çalıştır" confirmLabel="Dry-run çalıştır" message="Payload adapter doğrulamasından geçirilecek; gerçek pazaryeri mutasyonu yapılmayacak." />
    </>
  );
}

function ChannelTransfer({ notify }) {
  const remote = useRemote(() => get("/api/channel-transfers"), []);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [source, setSource] = useState("TRENDYOL");
  const [target, setTarget] = useState("HEPSIBURADA");
  const [recipes, setRecipes] = useState("");
  async function create() {
    const recipeIds = recipes.split(/[\s,;]+/).map(Number).filter(Boolean);
    const response = await post("/api/channel-transfers", {
      sourceMarketplace: source,
      targetMarketplace: target,
      recipeIds,
      idempotencyKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
    });
    notify(`${response.data.total_count} reçete güvenli aktarım önizlemesine alındı`);
    setOpen(false);
    remote.reload();
  }
  async function detail(row) {
    const response = await get(`/api/channel-transfers/${row.id}`);
    setSelected(response.data);
  }
  if (remote.loading) return <Loading />;
  if (remote.error) return <ErrorState error={remote.error} retry={remote.reload} />;
  const columns = [
    { key: "id", label: "Batch" },
    { key: "source_marketplace", label: "Kaynak" },
    { key: "target_marketplace", label: "Hedef" },
    { key: "total_count", label: "Toplam" },
    { key: "ready_count", label: "Hazır" },
    { key: "blocked_count", label: "Engelli" },
    { key: "status", label: "Durum", badge: true },
  ];
  return (
    <>
      <PageHeader title="Kanal Aktarımı" description="Reçeteleri hedef katalog, maliyet ve yayın şartlarıyla toplu değerlendirin" actions={<Button icon={Shuffle} onClick={() => setOpen(true)}>Kanala kopyala</Button>} />
      <div className="context-band warning-band"><Badge tone="warning">Önizleme</Badge><span>Tek işlem her reçeteyi ayrı doğrular; güvenlik kontrollerini atlamaz.</span></div>
      <DataTable columns={columns} rows={remote.data.items} onRowClick={detail} columnVisibilityKey="channel-transfers" exportFileName="kanal-aktarimlari" />
      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={`Kanal aktarımı #${selected?.id || ""}`} wide>
        {selected && (!selected.items?.length ? <Empty /> : <div className="transfer-items">
          {selected.items.map((item) => <article key={item.id}>
            <div><strong>{item.recipe_name}</strong><small>{item.recipe_code}</small></div>
            <Badge tone={item.item_status === "READY_TO_LIST" ? "success" : "warning"}>{item.item_status}</Badge>
            <span>{item.blocker_codes?.length || 0} engel</span>
            <small>{item.blocker_codes?.join(", ") || "Yayın önizlemesine hazır"}</small>
          </article>)}
        </div>)}
      </Drawer>
      <Modal open={open} onClose={() => setOpen(false)} title="Kanala kopyalama önizlemesi">
        <div className="modal-body form-grid two-col">
          <Field label="Kaynak"><select value={source} onChange={(event) => setSource(event.target.value)}>{marketplaces.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Hedef"><select value={target} onChange={(event) => setTarget(event.target.value)}>{marketplaces.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Reçete ID'leri" hint="Virgül, boşluk veya yeni satırla ayırın"><textarea rows="7" value={recipes} onChange={(event) => setRecipes(event.target.value)} placeholder="12, 13, 14" /></Field>
        </div>
        <div className="modal-actions"><Button variant="secondary" onClick={() => setOpen(false)}>Vazgeç</Button><Button icon={Shuffle} disabled={!recipes.trim() || source === target} onClick={create}>Önizlemeyi başlat</Button></div>
      </Modal>
    </>
  );
}

export default function PublishingCenter({ mode, notify }) {
  return mode === "channel-transfer" ? <ChannelTransfer notify={notify} /> : <Publishing notify={notify} />;
}
