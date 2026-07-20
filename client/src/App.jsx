import React, { lazy, Suspense, useEffect, useState } from "react";
import { get, post, setCsrf } from "./lib/api";
import Shell from "./components/Shell";
import { Loading, Toast } from "./components/ui";
import Login from "./pages/Login";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Products = lazy(() => import("./pages/Products"));
const Costs = lazy(() => import("./pages/Costs"));
const Operations = lazy(() => import("./pages/Operations"));
const Finance = lazy(() => import("./pages/Finance"));
const pageMap = {
  dashboard: Dashboard,
  products: Products,
  costs: Costs,
  mappings: Costs,
  commissions: Costs,
  shipping: Costs,
  finance: Finance,
  buybox: Operations,
  repricer: Operations,
  actions: Operations,
  learning: Operations,
  jobs: Operations,
  logs: Operations,
  settings: Operations,
};
export default function App() {
  const [user, setUser] = useState(null),
    [checking, setChecking] = useState(true),
    [route, setRoute] = useState(location.hash.slice(1) || "dashboard"),
    [toast, setToast] = useState(null),
    [dryRun, setDryRun] = useState(true),
    [integrations, setIntegrations] = useState(null),
    [marketplace, setMarketplace] = useState(
      () => localStorage.getItem("aslamaci-marketplace") || "TRENDYOL",
    );
  useEffect(() => {
    const fn = () => setRoute(location.hash.slice(1) || "dashboard");
    addEventListener("hashchange", fn);
    get("/api/auth/me")
      .then((x) => {
        setCsrf(x.csrfToken);
        setUser(x.user);
        return Promise.all([
          get("/api/repricer/settings"),
          get("/api/integrations"),
        ]);
      })
      .then(([repricerSettings, integrationStatus]) => {
        setDryRun(Boolean(repricerSettings.data.dryRun));
        setIntegrations(integrationStatus.data);
      })
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
    return () => removeEventListener("hashchange", fn);
  }, []);
  function navigate(next) {
    location.hash = next;
    setRoute(next);
  }
  function changeMarketplace(next) {
    const normalized = next === "HEPSIBURADA" ? next : "TRENDYOL";
    localStorage.setItem("aslamaci-marketplace", normalized);
    setMarketplace(normalized);
  }
  async function logout() {
    try {
      await post("/api/auth/logout");
    } finally {
      setCsrf("");
      setUser(null);
    }
  }
  if (checking) return <Loading />;
  if (!user) return <Login onLogin={setUser} />;
  const Page = pageMap[route] || Dashboard;
  return (
    <Shell
      route={route}
      onNavigate={navigate}
      onLogout={logout}
      dryRun={dryRun}
      marketplace={marketplace}
      onMarketplaceChange={changeMarketplace}
      integrations={integrations}
    >
      <Suspense fallback={<Loading />}>
        <Page
          mode={route}
          notify={(message, type = "success") => setToast({ message, type })}
          setDryRun={setDryRun}
          marketplace={marketplace}
        />
      </Suspense>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </Shell>
  );
}
