import React, { useMemo, useState } from "react";
import { Database, Plus, RefreshCw, ScanBarcode } from "lucide-react";
import { get, post } from "../lib/api";
import DataTable, { date, money } from "../components/DataTable";
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

function minor(value) {
  return money(Number(value || 0) / 100);
}

function Catalog({ notify }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [bootstrap, setBootstrap] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const remote = useRemote(
    () =>
      get(
        `/api/pim/products?page=${page}&limit=50&search=${encodeURIComponent(search)}`,
      ),
    [page, search],
  );

  async function previewBootstrap() {
    const response = await post("/api/pim/bootstrap/preview");
    setBootstrap(response.data);
    setConfirm(true);
  }

  async function applyBootstrap() {
    const response = await post("/api/pim/bootstrap/apply", {
      confirmation: "PIM_BOOTSTRAP_UYGULA",
    });
    setConfirm(false);
    notify(
      `${response.data.recipes} reçete ve ${response.data.listings} listing güncellendi`,
    );
    remote.reload();
  }

  if (remote.loading) return <Loading />;
  if (remote.error) return <ErrorState error={remote.error} retry={remote.reload} />;
  const columns = [
    { key: "product_name", label: "Fiziksel ürün" },
    { key: "brand", label: "Marka" },
    { key: "product_family", label: "Ürün ailesi" },
    { key: "variant", label: "Varyant" },
    { key: "cost_item_code", label: "Cost code" },
    { key: "status", label: "Durum", badge: true },
    { key: "updated_at", label: "Güncelleme", render: (row) => date(row.updated_at) },
  ];
  return (
    <>
      <PageHeader
        title="Ana Katalog"
        description="Pazaryerinden bağımsız fiziksel ürün bilgi merkezi"
        actions={
          <Button icon={Database} variant="secondary" onClick={previewBootstrap}>
            Mevcut veriyi aktar
          </Button>
        }
      />
      <div className="context-band">
        <Badge tone="info">Pazaryerinden bağımsız</Badge>
        <span>Cost code, fiziksel ürün ve üretici bilgisinin ortak kaynağı</span>
      </div>
      <div className="filters">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Ürün, marka veya cost code ara"
        />
      </div>
      <DataTable
        columns={columns}
        rows={remote.data.items}
        columnVisibilityKey="pim-physical-products"
        exportFileName="ana-katalog"
      />
      <Pagination
        page={page}
        limit={remote.data.limit}
        total={remote.data.total}
        onChange={setPage}
      />
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={applyBootstrap}
        title="Mevcut veriyi PIM'e aktar"
        confirmLabel="Aktarımı uygula"
        message={
          bootstrap
            ? `${bootstrap.physical_product_candidates} maliyet kalemi ve ${bootstrap.listing_candidates} mappingli listing idempotent biçimde merkezi kataloğa aktarılacak.`
            : "Aktarım önizlemesi hazırlanıyor."
        }
      />
    </>
  );
}

function Recipes({ notify }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [componentText, setComponentText] = useState("");
  const [approveConfirm, setApproveConfirm] = useState(false);
  const remote = useRemote(
    () =>
      get(
        `/api/pim/recipes?page=${page}&limit=50&search=${encodeURIComponent(search)}`,
      ),
    [page, search],
  );

  async function openRecipe(row) {
    const response = await get(`/api/pim/recipes/${row.id}`);
    setSelected(response.data);
  }

  async function createRecipe() {
    const components = componentText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [costItemCode, quantity] = line.split(";").map((item) => item.trim());
        return { costItemCode, quantity: Number(quantity || 1) };
      });
    await post("/api/pim/recipes", { recipeName, components });
    setCreating(false);
    setRecipeName("");
    setComponentText("");
    notify("Reçete taslağı oluşturuldu");
    remote.reload();
  }

  async function approveRecipe() {
    const response = await post(`/api/pim/recipes/${selected.id}/approve`, {
      confirmation: "RECETEYI_ONAYLA",
    });
    setSelected((current) => ({ ...current, ...response.data }));
    setApproveConfirm(false);
    notify("Reçete yayın önizlemelerinde kullanılmak üzere onaylandı");
    remote.reload();
  }

  if (remote.loading) return <Loading />;
  if (remote.error) return <ErrorState error={remote.error} retry={remote.reload} />;
  const columns = [
    { key: "recipe_code", label: "Reçete kodu" },
    { key: "recipe_name", label: "Reçete" },
    { key: "recipe_type", label: "Tip", badge: true },
    { key: "component_count", label: "Bileşen" },
    { key: "listing_count", label: "Listing" },
    { key: "total_cost_minor", label: "Toplam maliyet", render: (row) => minor(row.total_cost_minor) },
    { key: "final_desi", label: "Nihai desi" },
    { key: "status", label: "Durum", badge: true },
  ];
  return (
    <>
      <PageHeader
        title="Reçeteler ve Bundle'lar"
        description="Fiziksel ürünlerden oluşan pazaryeri bağımsız satış reçeteleri"
        actions={<Button icon={Plus} onClick={() => setCreating(true)}>Yeni reçete</Button>}
      />
      <div className="context-band">
        <Badge tone="info">Pazaryerinden bağımsız</Badge>
        <span>Aynı reçete farklı pazaryerlerinde ayrı listing kimliği ve fiyatla kullanılabilir</span>
      </div>
      <div className="filters">
        <SearchInput value={search} onChange={setSearch} placeholder="Reçete ara" />
      </div>
      <DataTable
        columns={columns}
        rows={remote.data.items}
        onRowClick={openRecipe}
        columnVisibilityKey="pim-recipes"
        exportFileName="receteler"
      />
      <Pagination page={page} limit={remote.data.limit} total={remote.data.total} onChange={setPage} />
      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.recipe_name || "Reçete"}
        wide
      >
        {selected && (
          <div className="recipe-detail">
            <div className="metric-row">
              <div><span>Maliyet</span><strong>{minor(selected.total_cost_minor)}</strong></div>
              <div><span>Kesirli desi</span><strong>{selected.fractional_desi}</strong></div>
              <div><span>Nihai desi</span><strong>{selected.final_desi}</strong></div>
              <div><span>Fingerprint</span><strong title={selected.bundle_fingerprint}>{selected.bundle_fingerprint.slice(0, 12)}</strong></div>
            </div>
            <div className="context-band">
              <Badge tone={selected.status === "APPROVED" ? "success" : "warning"}>{selected.status}</Badge>
              <span>{selected.status === "APPROVED" ? "Reçete yayın önizlemelerinde kullanılabilir." : "Reçete yayın önizlemesinden önce insan onayı bekliyor."}</span>
              {selected.status !== "APPROVED" && <Button onClick={() => setApproveConfirm(true)}>Reçeteyi onayla</Button>}
            </div>
            <h3>Bileşenler</h3>
            <div className="recipe-components">
              {selected.components.map((item) => (
                <div key={item.id}>
                  <div><strong>{item.product_name}</strong><small>{item.cost_item_code}</small></div>
                  <span>{item.quantity} adet</span>
                  <b>{money(Number(item.unit_cost) * Number(item.quantity))}</b>
                </div>
              ))}
            </div>
            <h3>Pazaryeri listingleri</h3>
            {!selected.listings.length ? <Empty label="Bu reçeteye bağlı listing yok" /> : (
              <div className="recipe-components">
                {selected.listings.map((item) => (
                  <div key={item.id}><strong>{item.marketplace}</strong><span>{item.seller_listing_barcode}</span><Badge tone="info">{item.publication_state}</Badge></div>
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>
      <Confirm
        open={approveConfirm}
        onClose={() => setApproveConfirm(false)}
        onConfirm={approveRecipe}
        title="Reçeteyi onayla"
        confirmLabel="Reçeteyi onayla"
        message="Bileşenler, adetler, maliyet ve desi kontrol edildi olarak işaretlenecek. Bu işlem pazaryerinde değişiklik yapmaz."
      />
      <Modal open={creating} onClose={() => setCreating(false)} title="Yeni reçete taslağı">
        <div className="modal-body form-grid">
          <Field label="Reçete adı"><input value={recipeName} onChange={(event) => setRecipeName(event.target.value)} /></Field>
          <Field label="Bileşenler" hint="Her satır: COST_CODE; adet">
            <textarea rows="7" value={componentText} onChange={(event) => setComponentText(event.target.value)} placeholder="ACTISOFT_MENEKSE_1500; 2" />
          </Field>
        </div>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setCreating(false)}>Vazgeç</Button>
          <Button onClick={createRecipe}>Taslağı oluştur</Button>
        </div>
      </Modal>
    </>
  );
}

function BarcodePool({ notify }) {
  const [marketplace, setMarketplace] = useState("HEPSIBURADA");
  const [recipeId, setRecipeId] = useState("");
  const [preview, setPreview] = useState(null);
  const remote = useRemote(
    () => get(`/api/listing-barcodes?marketplace=${marketplace}&limit=100`),
    [marketplace],
  );
  async function prepare() {
    const response = await post("/api/listing-barcodes/preview", { marketplace, recipeId });
    setPreview(response.data);
  }
  async function allocate() {
    await post("/api/listing-barcodes/allocate", {
      marketplace,
      recipeId,
      confirmation: "LISTING_BARKODU_TAHSIS_ET",
    });
    notify("Listing barkodu reçeteye rezerve edildi");
    setPreview(null);
    remote.reload();
  }
  const columns = useMemo(() => [
    { key: "barcode", label: "Listing barkodu" },
    { key: "marketplace", label: "Pazaryeri" },
    { key: "recipe_code", label: "Reçete kodu" },
    { key: "recipe_name", label: "Reçete" },
    { key: "identifier_source", label: "Kaynak", badge: true },
    { key: "status", label: "Durum", badge: true },
    { key: "assigned_at", label: "Tahsis", render: (row) => date(row.assigned_at) },
  ], []);
  if (remote.loading) return <Loading />;
  if (remote.error) return <ErrorState error={remote.error} retry={remote.reload} />;
  return (
    <>
      <PageHeader title="Listing Barkod Havuzu" description="Üretici GTIN'inden ayrı, reçete ve hedef kanala bağlı listing kimlikleri" />
      <div className="context-band warning-band">
        <Badge tone="warning">Onay gerekli</Badge>
        <span>Önizleme barkodu tüketmez. Tahsis yalnız açık onayla RESERVED durumuna geçer.</span>
      </div>
      <div className="command-bar">
        <select value={marketplace} onChange={(event) => setMarketplace(event.target.value)}>
          {['TRENDYOL','HEPSIBURADA','PAZARAMA','IDEFIX','N11','PTTAVM'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <input type="number" min="1" value={recipeId} onChange={(event) => setRecipeId(event.target.value)} placeholder="Reçete ID" />
        <Button icon={ScanBarcode} onClick={prepare} disabled={!recipeId}>Barkodu önizle</Button>
        <Button icon={RefreshCw} variant="secondary" onClick={remote.reload}>Yenile</Button>
      </div>
      <DataTable columns={columns} rows={remote.data.items} columnVisibilityKey="listing-barcode-pool" exportFileName="listing-barkod-havuzu" />
      <Confirm
        open={Boolean(preview && !preview.existing)}
        onClose={() => setPreview(null)}
        onConfirm={allocate}
        title="Listing barkodunu rezerve et"
        confirmLabel="Barkodu tahsis et"
        message={preview ? `${preview.barcode}, ${preview.recipe.recipe_name} reçetesi için ${marketplace} kanalına rezerve edilecek.` : ""}
      />
      {preview?.existing && (
        <div className="inline-notice success"><strong>Mevcut tahsis</strong><span>{preview.barcode} zaten bu reçeteye bağlı.</span></div>
      )}
    </>
  );
}

export default function CatalogCenter({ mode, notify }) {
  if (mode === "recipes") return <Recipes notify={notify} />;
  if (mode === "barcode-pool") return <BarcodePool notify={notify} />;
  return <Catalog notify={notify} />;
}
