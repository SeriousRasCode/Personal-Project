import { useEffect, useState } from "react";
import { api, type Session } from "../lib/api";
import { canAccessPage } from "../lib/permissions";

type Point = { id: string; name: string; code: string };
export function Dashboard({ session }: { session: Session | null }) {
  const [points, setPoints] = useState<Point[]>([]);
  const [leaks, setLeaks] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      api<{ items: Point[] }>("/public/standpipes?limit=100&page=1"),
      api<{ items: unknown[] }>("/leaks/public/active"),
    ])
      .then(([p, l]) => {
        setPoints(p.items);
        setLeaks(l.items.length);
      })
      .catch(() =>
        setError(
          "Network information is temporarily unavailable. Please refresh to try again.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);
  const operational = canAccessPage("operations", session);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WATER NETWORK, AT A GLANCE</p>
          <h1>
            {session
              ? `Welcome back, ${session.user.displayName.split(" ")[0]}.`
              : "Water connects us."}
          </h1>
          <p>A clearer view of your community’s water, all in one place.</p>
        </div>
        <a className="button button-outline" href="#water-points">
          Explore water points ↗
        </a>
      </div>
      <section className="welcome-banner">
        <div>
          <span className="banner-label">JIMMA · COMMUNITY WATER NETWORK</span>
          <h2>
            {operational
              ? "A coordinated network.\nA better day for everyone."
              : "Find water. Plan your day.\nKeep your community informed."}
          </h2>
          <p>
            {operational
              ? "Stay on top of repairs, service schedules and the people who depend on them."
              : "Explore local water points and share an update to help your neighbours."}
          </p>
          <a
            className="button button-light"
            href={operational ? "#operations" : session ? "#reports" : "#auth"}
          >
            {operational ? "View work orders" : "Share a water update"}{" "}
            <span>→</span>
          </a>
        </div>
        <div className="water-art" aria-hidden="true">
          <div className="water-ring">
            <span>≈</span>
          </div>
          <div className="art-caption">Water, together.</div>
        </div>
      </section>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <section className="metrics" aria-label="Network summary">
        <article>
          <span className="metric-icon">◉</span>
          <p>Public water points</p>
          <strong>{loading ? "…" : error ? "—" : points.length}</strong>
          <small>Available in the public directory</small>
        </article>
        <article>
          <span className="metric-icon amber">⌁</span>
          <p>Active leak areas</p>
          <strong>{leaks ?? (loading ? "…" : "—")}</strong>
          <small>Community reports under review</small>
        </article>
        <article className="metric-action">
          <span className="metric-icon">+</span>
          <p>Your observations matter</p>
          <h3>
            Small updates.
            <br />A stronger community.
          </h3>
          <a href={session ? "#reports" : "#auth"}>Share what you see →</a>
        </article>
      </section>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Water points near your community</h2>
              <p>Explore the public network before you head out.</p>
            </div>
            <a href="#water-points">View all →</a>
          </div>
          {loading ? (
            <p className="empty-state">Loading water points…</p>
          ) : points.length ? (
            <div className="point-list">
              {points.slice(0, 4).map((p) => (
                <a href="#water-points" key={p.id}>
                  <span className="point-symbol">◉</span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.code} · Public water point</small>
                  </span>
                  <span className="row-arrow">↗</span>
                </a>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              {error
                ? "Reconnect to see the directory."
                : "No public water points have been added yet."}
            </p>
          )}
        </section>
        <section className="panel next-steps">
          <p className="eyebrow">QUICK ACTIONS</p>
          <h2>What would you like to do?</h2>
          <a href={operational ? "#operations" : "#water-points"}>
            <span>01</span>
            <div>
              <strong>
                {operational ? "Review assigned work" : "Find a water point"}
              </strong>
              <small>
                {operational
                  ? "See repairs and current work orders"
                  : "Browse your community directory"}
              </small>
            </div>
            →
          </a>
          <a href={session ? "#reports" : "#auth"}>
            <span>02</span>
            <div>
              <strong>Report a water issue</strong>
              <small>Share flow, queues or a suspected leak</small>
            </div>
            →
          </a>
          <a href={session ? "#inbox" : "#auth"}>
            <span>03</span>
            <div>
              <strong>Stay informed</strong>
              <small>Read updates connected to your account</small>
            </div>
            →
          </a>
        </section>
      </div>
    </>
  );
}
