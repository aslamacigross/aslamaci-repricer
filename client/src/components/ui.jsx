import React, { useEffect, useState } from "react";
import {
  X,
  AlertTriangle,
  Inbox,
  LoaderCircle,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
export function Button({
  children,
  variant = "primary",
  icon: Icon,
  className = "",
  ...props
}) {
  return (
    <button className={`btn btn-${variant} ${className}`} {...props}>
      {Icon && <Icon size={17} />}
      <span>{children}</span>
    </button>
  );
}
export function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button className="icon-btn" title={label} aria-label={label} {...props}>
      <Icon size={19} />
    </button>
  );
}
export function Badge({ children, tone = "neutral" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function toneFor(value) {
  const t = String(value ?? "").toLowerCase();
  if (/tamam|complete|success|buybox bizde|sent|approved|evet/.test(t))
    return "success";
  if (/hata|failed|zarar|risk|missing|eksik|blocked|reject/.test(t))
    return "danger";
  if (/uyarı|pending|bekle|stale|dry|izle/.test(t)) return "warning";
  if (/running|işlem|sync|info/.test(t)) return "info";
  return "neutral";
}
export function PageHeader({ title, description, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
export function Loading({ label = "Veriler yükleniyor" }) {
  return (
    <div className="state">
      <LoaderCircle className="spin" />
      <p>{label}</p>
    </div>
  );
}
export function Empty({ label = "Gösterilecek kayıt yok" }) {
  return (
    <div className="state">
      <Inbox />
      <p>{label}</p>
    </div>
  );
}
export function ErrorState({ error, retry }) {
  return (
    <div className="state state-error">
      <AlertTriangle />
      <strong>Veriler alınamadı</strong>
      <p>{error?.message}</p>
      {retry && <Button onClick={retry}>Tekrar dene</Button>}
    </div>
  );
}
export function Drawer({ open, onClose, title, children, wide = false }) {
  useEffect(() => {
    const fn = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  if (!open) return null;
  return (
    <div
      className="drawer-layer"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside className={`drawer ${wide ? "drawer-wide" : ""}`}>
        <header>
          <h2>{title}</h2>
          <IconButton icon={X} label="Kapat" onClick={onClose} />
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
export function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div
      className="modal-layer"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <header>
          <h2>{title}</h2>
          <IconButton icon={X} label="Kapat" onClick={onClose} />
        </header>
        {children}
      </div>
    </div>
  );
}
export function Confirm({
  open,
  onClose,
  onConfirm,
  title = "İşlemi onayla",
  message,
  confirmLabel = "Onayla",
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="confirm">
        <AlertTriangle />
        <p>{message}</p>
        <div>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function SearchInput({ value, onChange, placeholder = "Ara" }) {
  return (
    <label className="search">
      <Search size={18} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
export function Pagination({ page, total, limit, onChange }) {
  const pages = Math.max(Math.ceil(total / limit), 1);
  return (
    <div className="pagination">
      <span>{total} kayıt</span>
      <div>
        <IconButton
          icon={ChevronLeft}
          label="Önceki"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        />
        <b>
          {page} / {pages}
        </b>
        <IconButton
          icon={ChevronRight}
          label="Sonraki"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        />
      </div>
    </div>
  );
}
export function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onClose, 4000);
    return () => clearTimeout(id);
  }, [toast, onClose]);
  return toast ? (
    <div className={`toast toast-${toast.type || "success"}`}>
      {toast.message}
      <button onClick={onClose}>×</button>
    </div>
  ) : null;
}
export function useRemote(loader, deps = []) {
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    loader()
      .then((x) => live && setData(x))
      .catch((x) => live && setError(x))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  return { data, loading, error, reload: () => setTick((x) => x + 1) };
}
