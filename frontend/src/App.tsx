import { useEffect, useState } from "react";
import { getSession, signOut, type Session } from "./lib/api";
import { AuthPage } from "./features/auth";
import { Reports } from "./features/reports";
import { GeographyAdmin } from "./features/geography";
import { Dashboard } from "./features/dashboard";
import { navigation, roleLabels } from "./components/navigation";
import {
  Notifications,
  Preferences,
  Resource,
  Schedules,
  Telemetry,
  UserAdministration,
  ValveControls,
  WorkOrders,
} from "./features/panels";
import {
  AuditLog,
  OutboxMonitor,
  StorageAdmin,
  UssdSessions,
} from "./features/admin-panels";
import "./App.css";
import { ThemeToggle } from "./components/ThemeToggle";
import "./theme.css";
import "./motion.css";
import { GuidedTour } from "./components/GuidedTour";
import "./tour.css";
import "./tour-details.css";

export default function App() {
  const [session, setSession] = useState<Session | null>(getSession());
  const [route, setRoute] = useState(location.hash.slice(1) || "overview");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const update = () => {
      setRoute(location.hash.slice(1) || "overview");
      setMenuOpen(false);
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", update);
    return () => removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [menuOpen]);
  const role = session?.user.role;
  const links = navigation.filter(
    (item) =>
      (!item.authenticated || session) &&
      (!item.roles || (role && item.roles.includes(role))),
  );
  const active = links.find((item) => item.id === route);
  const groups = [...new Set(links.map((item) => item.group))];
  const pages = {
    overview: <Dashboard session={session} />,
    "water-points": (
      <Resource
        heading="Water points"
        endpoint="/public/standpipes?limit=100&page=1"
        columns={[
          ["name", "Name"],
          ["code", "Code"],
        ]}
      />
    ),
    reports: <Reports />,
    operations: <WorkOrders />,
    telemetry: <Telemetry />,
    maintenance: <ValveControls />,
    schedules: <Schedules />,
    geography: <GeographyAdmin />,
    users: <UserAdministration />,
    ussd: <UssdSessions />,
    storage: <StorageAdmin />,
    audit: <AuditLog />,
    outbox: <OutboxMonitor />,
    inbox: <Notifications />,
    preferences: <Preferences />,
  };
  const authenticated = (next: Session) => {
    setSession(next);
    location.hash = "#overview";
  };
  if (route === "auth" || route === "login" || route === "signup") {
    return <AuthPage onAuthenticated={authenticated} />;
  }
  return (
    <div
      className={`app-shell ${menuOpen ? "menu-open" : ""}`}
      data-role={role || "GUEST"}
    >
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      {menuOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className="sidebar" aria-label="Workspace navigation">
        <a className="brand" href="#overview">
          <span className="brand-logo">≈</span>
          <span>
            <strong>
              HydroJimma<span className="brand-period">.</span>
            </strong>
            <small>Water, together.</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-dot" />
          {roleLabels[role || "CITIZEN"] || "Community portal"}
          <small>JIMMA, ETHIOPIA</small>
        </div>
        <nav className="nav-list">
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <p>{group}</p>
              {links
                .filter((item) => item.group === group)
                .map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    data-tour={item.id}
                    className={`nav-link ${route === item.id ? "active" : ""}`}
                    aria-current={route === item.id ? "page" : undefined}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                    {route === item.id && <span className="active-dot" />}
                  </a>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">
            {session?.user.displayName.charAt(0) || "G"}
          </span>
          <div>
            <strong>{session?.user.displayName || "Guest explorer"}</strong>
            <small>
              {session
                ? roleLabels[role!] || role
                : "Your community, connected"}
            </small>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="menu-button"
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              ☰
            </button>
            <span>Workspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>
              {route === "auth"
                ? "Your account"
                : active?.label || "Page unavailable"}
            </strong>
          </div>
          <div className="topbar-actions">
            <GuidedTour
              key={session?.user.id || "guest"}
              session={session}
              onMenuChange={setMenuOpen}
            />
            <ThemeToggle />
            <span className="location-label">⌖ Jimma, Ethiopia</span>
            {session ? (
              <>
                <a
                  href="#inbox"
                  className="inbox-button"
                  aria-label="Open inbox"
                >
                  ✉
                </a>
                <button
                  className="button button-outline"
                  onClick={async () => {
                    await signOut();
                    setSession(null);
                    location.hash = "#overview";
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <a className="button button-primary" href="#auth">
                Sign in <span>↗</span>
              </a>
            )}
          </div>
        </header>
        <main id="main" tabIndex={-1} key={route} className="route-content">
          {active ? (
            pages[route as keyof typeof pages]
          ) : (
            <section className="panel">
              <h1>This page is unavailable</h1>
              <p>
                Sign in with an appropriate account to access this workspace.
              </p>
              <a className="button button-primary" href="#overview">
                Back to overview
              </a>
            </section>
          )}
        </main>
        <footer className="app-footer">
          <span>HydroJimma · Water, together.</span>
          <span>Built for the community in Jimma.</span>
        </footer>
      </div>
    </div>
  );
}
