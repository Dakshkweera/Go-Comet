import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { HealthResponse } from "../types/api.js";
import { api } from "../api.js";
import { useShipments } from "../shipmentData.js";
import { exceptionCount, isProcessing } from "../shipmentDomain.js";
import { Link, navigate, usePath } from "../router.js";
import { Icon, type IconName } from "./Icon.js";

type NavItem = { to: string; label: string; icon: IconName };
type NavGroup = { heading: string | null; items: NavItem[] };

const NAV: NavGroup[] = [
  { heading: null, items: [{ to: "/", label: "Overview", icon: "overview" }] },
  {
    heading: "Email workflow",
    items: [
      { to: "/inbox", label: "Inbox", icon: "inbox" },
      { to: "/processing", label: "Processing", icon: "clock" },
      { to: "/exceptions", label: "Exceptions", icon: "exceptions" },
      { to: "/shipments", label: "Shipments", icon: "shipments" },
      { to: "/sent-emails", label: "Sent emails", icon: "send" },
    ],
  },
  {
    heading: "Simulation",
    items: [{ to: "/simulate", label: "Simulate email", icon: "mail" }],
  },
  {
    heading: "Workspace",
    items: [
      { to: "/documents", label: "Documents", icon: "documents" },
      { to: "/queries", label: "Queries", icon: "queries" },
    ],
  },
  {
    heading: "Configuration",
    items: [
      { to: "/customers", label: "Customers", icon: "customers" },
      { to: "/rules", label: "Rules", icon: "rules" },
    ],
  },
];

const isActive = (item: NavItem, path: string) =>
  item.to === "/" ? path === "/" : path === item.to || path.startsWith(`${item.to}/`);

export function sectionFor(path: string) {
  return NAV.flatMap((group) => group.items).find((item) => isActive(item, path)) ?? null;
}

type Health = "checking" | "ok" | "degraded" | "offline";

function useHealth(): Health {
  const [health, setHealth] = useState<Health>("checking");
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .health()
        .then((h: HealthResponse | null) => {
          if (!cancelled) setHealth(h?.status === "ok" ? "ok" : h ? "degraded" : "offline");
        })
        .catch(() => !cancelled && setHealth("offline"));
    check();
    const timer = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return health;
}

const HEALTH_LABEL: Record<Health, string> = {
  checking: "Checking status…",
  ok: "System operational",
  degraded: "Database degraded",
  offline: "API unreachable",
};

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const path = usePath();
  const health = useHealth();
  const { shipments } = useShipments({ watchForMail: false });
  const counts: Record<string, { value: number; title: string }> = {
    "/processing": {
      value: shipments?.filter((s) => isProcessing(s.status)).length ?? 0,
      title: "Emails being processed",
    },
    "/exceptions": {
      value: exceptionCount(shipments ?? []),
      title: "Shipments that need your decision or a reply",
    },
  };

  const renderItem = (item: NavItem) => {
    const active = isActive(item, path);
    const count = counts[item.to];
    return (
      <li key={item.to}>
        <Link
          to={item.to}
          className={active ? "nav-link is-active" : "nav-link"}
          aria-current={active ? "page" : undefined}
          onClick={onClose}
        >
          <Icon name={item.icon} size={17} />
          <span>{item.label}</span>
          {count && count.value > 0 && (
            <span className="nav-count" title={count.title}>
              {count.value}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <aside className={open ? "sidebar is-open" : "sidebar"} aria-label="Primary">
      <Link to="/" className="brand" onClick={onClose}>
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M12 2 22 12 12 22 2 12z" fill="currentColor" opacity=".35" />
            <path d="M12 6.5 17.5 12 12 17.5 6.5 12z" fill="currentColor" />
          </svg>
        </span>
        <span>
          <span className="brand-name">Nova</span>
          <span className="brand-sub">Trade Intelligence</span>
        </span>
      </Link>

      <nav className="nav">
        {NAV.map((group) => (
          <Fragment key={group.heading ?? "home"}>
            {group.heading && <p className="nav-heading">{group.heading}</p>}
            <ul>{group.items.map(renderItem)}</ul>
          </Fragment>
        ))}
      </nav>

      <div className={`sidebar-status health-${health}`} role="status">
        <span className="dot" />
        {HEALTH_LABEL[health]}
      </div>
    </aside>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const path = usePath();
  const section = sectionFor(path);
  const [query, setQuery] = useState("");

  function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/shipments?q=${encodeURIComponent(q)}` : "/shipments");
    setQuery("");
  }

  return (
    <header className="topbar">
      <button type="button" className="btn btn-ghost btn-icon topbar-menu" onClick={onMenu}>
        <Icon name="menu" size={18} />
        <span className="sr-only">Open navigation</span>
      </button>
      <div className="topbar-crumbs">
        <span className="text-muted">Nova</span>
        <Icon name="chevronRight" size={14} className="text-faint" />
        <span>{section?.label ?? "Not found"}</span>
      </div>
      <form className="topbar-search" role="search" onSubmit={search}>
        <Icon name="search" size={15} className="topbar-search-icon" />
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shipments, suppliers, subjects…"
          aria-label="Search shipments"
        />
      </form>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const path = usePath();

  useEffect(() => setMenuOpen(false), [path]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="shell">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <div className="shell-main">
        <Topbar onMenu={() => setMenuOpen(true)} />
        <main className="content" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
