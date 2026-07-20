import React, { useEffect, useState } from "react";
import {
  LayoutDashboard,
  PackageSearch,
  Coins,
  GitBranch,
  Percent,
  Truck,
  ScanSearch,
  Gauge,
  ClipboardCheck,
  BrainCircuit,
  Clock3,
  ScrollText,
  Settings,
  LogOut,
  Menu,
  X,
  ShieldCheck,
  ChartNoAxesCombined,
} from "lucide-react";
import { IconButton, Badge } from "./ui";
const links = [
  ["dashboard", "Genel Bakış", LayoutDashboard],
  ["products", "Ürünler", PackageSearch],
  ["costs", "Maliyet Kalemleri", Coins],
  ["mappings", "Ürün Mapping", GitBranch],
  ["commissions", "Komisyonlar", Percent],
  ["shipping", "Kargo & Ambalaj", Truck],
  ["finance", "Satış & Kâr", ChartNoAxesCombined],
  ["buybox", "Buybox", ScanSearch],
  ["repricer", "Repricer", Gauge],
  ["actions", "Fiyat Aksiyonları", ClipboardCheck],
  ["learning", "Öğrenme Merkezi", BrainCircuit],
  ["jobs", "Joblar", Clock3],
  ["logs", "Loglar", ScrollText],
  ["settings", "Sistem Ayarları", Settings],
];
export default function Shell({
  route,
  onNavigate,
  onLogout,
  children,
  dryRun = true,
  marketplace = "TRENDYOL",
  onMarketplaceChange,
  integrations,
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [route]);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <strong>Aşlamacı ERP</strong>
            <small>Pazaryeri Operasyonları V2</small>
          </div>
          <IconButton
            className="mobile-close"
            icon={X}
            label="Menüyü kapat"
            onClick={() => setOpen(false)}
          />
        </div>
        <nav>
          {links.map(([key, label, Icon]) => (
            <button
              key={key}
              className={route === key ? "active" : ""}
              onClick={() => onNavigate(key)}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>
            <ShieldCheck size={18} />
            <span>Güvenli mod</span>
            <Badge tone={dryRun ? "warning" : "success"}>
              {dryRun ? "Dry-run" : "Canlı"}
            </Badge>
          </div>
          <button onClick={onLogout}>
            <LogOut size={18} />
            Çıkış yap
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <IconButton
            icon={Menu}
            label="Menüyü aç"
            onClick={() => setOpen(true)}
          />
          <div className="top-title">Operasyon Merkezi</div>
          <div
            className="segmented marketplace-switch"
            aria-label="Pazaryeri seçimi"
          >
            <button
              type="button"
              className={marketplace === "TRENDYOL" ? "active" : ""}
              onClick={() => onMarketplaceChange?.("TRENDYOL")}
            >
              Trendyol
            </button>
            <button
              type="button"
              className={marketplace === "HEPSIBURADA" ? "active" : ""}
              onClick={() => onMarketplaceChange?.("HEPSIBURADA")}
            >
              Hepsiburada
            </button>
          </div>
          {marketplace === "HEPSIBURADA" && (
            <Badge
              tone={
                integrations?.hepsiburada?.configured ? "success" : "warning"
              }
            >
              {integrations?.hepsiburada?.configured
                ? "Bağlantı hazır"
                : "Bağlantı bekleniyor"}
            </Badge>
          )}
          <div className="top-status">
            <span className="status-dot" />
            Sistem çevrimiçi
          </div>
        </header>
        <main>{children}</main>
      </div>
      {open && (
        <div className="sidebar-backdrop" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}
