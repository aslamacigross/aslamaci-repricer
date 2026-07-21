import React, { useState } from "react";
import {
  LockKeyhole,
  UserRound,
  ShieldCheck,
  LoaderCircle,
} from "lucide-react";
import { post, setCsrf } from "../lib/api";
export default function Login({ onLogin }) {
  const [form, setForm] = useState({ username: "admin", password: "" }),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await post("/api/auth/login", form);
      setCsrf(data.csrfToken);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-brand">
        <span>A</span>
        <div>
          <strong>Aşlamacı ERP</strong>
          <small>Maliyet, Buybox ve Öğrenen Repricer</small>
        </div>
      </div>
      <form className="login-panel" onSubmit={submit}>
        <div className="login-icon">
          <ShieldCheck />
        </div>
        <h1>Yönetim paneli</h1>
        <p>Operasyon verilerinize güvenli erişim</p>
        {error && <div className="form-error">{error}</div>}
        <label>
          <span>Kullanıcı adı</span>
          <div>
            <UserRound />
            <input
              autoComplete="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>
        </label>
        <label>
          <span>Parola</span>
          <div>
            <LockKeyhole />
            <input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoFocus
            />
          </div>
        </label>
        <button disabled={loading}>
          {loading ? <LoaderCircle className="spin" /> : <LockKeyhole />}
          {loading ? "Giriş yapılıyor" : "Giriş yap"}
        </button>
        <small>Oturum 12 saat boyunca güvenli çerez ile korunur.</small>
      </form>
    </div>
  );
}
