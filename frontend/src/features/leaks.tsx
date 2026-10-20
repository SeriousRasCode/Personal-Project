import { useState } from "react";
import { api, getSession } from "../lib/api";
import { canPerform } from "../lib/permissions";
import {
  human,
  leakTransitions,
  when,
  type Cluster,
  type LeakReport,
  type WorkOrder,
  type Page,
} from "../lib/dispatch";
import { useCollection } from "../lib/use-collection";
import { Badge, DispatchPage, Pager } from "../components/dispatch-ui";
import { FormField, FormFeedback } from "../components/forms";
import { WorkOrderForm } from "../components/work-order-form";
export function LeakTriage() {
  const [status, setStatus] = useState("OPEN"),
    [severity, setSeverity] = useState(""),
    [page, setPage] = useState(1);
  const data = useCollection<Cluster>(
    `/leaks/clusters?limit=20&page=${page}${status ? "&status=" + status : ""}${severity ? "&severity=" + severity : ""}`,
  );
  const [detail, setDetail] = useState<{
      cluster: Cluster;
      reports: LeakReport[];
    } | null>(null),
    [orders, setOrders] = useState<WorkOrder[]>([]),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [photos, setPhotos] = useState<Record<string, string>>({});
  const manage = canPerform("leak.triage", getSession());
  async function open(id: string) {
    setBusy(true);
    setError("");
    setCreating(false);
    setPhotos({});
    try {
      const [record, linked] = await Promise.all([
        api<{ cluster: Cluster; reports: LeakReport[] }>(
          `/leaks/clusters/${id}`,
        ),
        api<Page<WorkOrder>>(`/work-orders?leakClusterId=${id}&limit=100`),
      ]);
      setDetail(record);
      setOrders(linked.items);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DispatchPage
      title="Leak investigation"
      description="Review corroborating reports, triage the incident and dispatch a repair team."
    >
      <div className="dispatch-toolbar">
        <FormField label="Incident status">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {["OPEN", "TRIAGED", "INVESTIGATING", "RESOLVED", "REJECTED"].map(
              (s) => (
                <option key={s} value={s}>
                  {human(s)}
                </option>
              ),
            )}
          </select>
        </FormField>
        <FormField label="Severity">
          <select
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All severities</option>
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        <button className="button button-outline" onClick={data.reload}>
          Refresh
        </button>
      </div>
      <FormFeedback error={error || data.error} message={message} />
      <div className="dispatch-split">
        <section className="panel">
          <h2>Clustered incidents</h2>
          {data.loading && <p role="status">Loading incidents…</p>}
          <div className="dispatch-list">
            {data.items.map((cluster) => (
              <button
                className={`dispatch-record ${detail?.cluster.id === cluster.id ? "is-selected" : ""}`}
                key={cluster.id}
                disabled={busy}
                onClick={() => void open(cluster.id)}
              >
                <strong>
                  {cluster.code} · {cluster.kebeleCode}
                </strong>
                <span>
                  {cluster.reportCount} reports ·{" "}
                  {Math.round(cluster.confidence * 100)}% confidence
                </span>
                <Badge value={cluster.severity} />
                <Badge value={cluster.status} />
              </button>
            ))}
          </div>
          {!data.loading && !data.items.length && (
            <p>No incidents match these filters.</p>
          )}
          <Pager page={page} pages={data.meta?.totalPages} onChange={setPage} />
        </section>
        <section className="panel">
          {detail ? (
            <>
              <h2>{detail.cluster.code}</h2>
              <p>
                {detail.cluster.kebeleCode} · {detail.cluster.reportCount}{" "}
                corroborating reports
              </p>
              <p>
                Location:{" "}
                {detail.cluster.centroidLatitude?.toFixed(5) ?? "Unknown"},{" "}
                {detail.cluster.centroidLongitude?.toFixed(5) ?? "Unknown"}
              </p>
              {detail.cluster.centroidLatitude != null &&
                detail.cluster.centroidLongitude != null && (
                  <a
                    className="button button-outline"
                    href={`https://www.openstreetmap.org/?mlat=${detail.cluster.centroidLatitude}&mlon=${detail.cluster.centroidLongitude}#map=17/${detail.cluster.centroidLatitude}/${detail.cluster.centroidLongitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open incident location ↗
                  </a>
                )}
              {manage &&
                (leakTransitions[detail.cluster.status] || []).length > 0 && (
                  <form
                    className="workflow-form"
                    key={detail.cluster.id + detail.cluster.updatedAt}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      setBusy(true);
                      setError("");
                      try {
                        await api(
                          `/leaks/clusters/${detail.cluster.id}/status`,
                          {
                            method: "PATCH",
                            body: JSON.stringify({
                              status: form.get("status"),
                              note: form.get("note") || null,
                            }),
                          },
                        );
                        await open(detail.cluster.id);
                        await data.reload();
                        setMessage("Incident status updated.");
                      } catch (failure) {
                        setError((failure as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <FormField label="Triage decision">
                      <select name="status">
                        {leakTransitions[detail.cluster.status].map((s) => (
                          <option value={s} key={s}>
                            {human(s)}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Decision note" optional>
                      <textarea name="note" maxLength={1000} />
                    </FormField>
                    <button className="button button-primary" disabled={busy}>
                      Save triage decision
                    </button>
                  </form>
                )}
              <h3>Maintenance response</h3>
              {orders.map((order) => (
                <button
                  className="dispatch-record"
                  key={order.id}
                  onClick={() => {
                    sessionStorage.setItem("hydrojimma.open-order", order.id);
                    location.hash = "operations";
                  }}
                >
                  {order.title} · {human(order.status)} →
                </button>
              ))}
              {!orders.length && (
                <p>No work order is linked to this incident.</p>
              )}
              {manage &&
                !["RESOLVED", "REJECTED"].includes(detail.cluster.status) &&
                !creating && (
                  <button
                    className="button button-primary"
                    onClick={() => setCreating(true)}
                  >
                    Create linked work order
                  </button>
                )}
              {creating && (
                <WorkOrderForm
                  key={detail.cluster.id}
                  clusterId={detail.cluster.id}
                  suggestedTitle={`Repair leak ${detail.cluster.code}`}
                  onCancel={() => setCreating(false)}
                  onSaved={(order) => {
                    setOrders((previous) => [order, ...previous]);
                    setCreating(false);
                    setMessage(
                      "Work order created and linked to this incident.",
                    );
                  }}
                />
              )}
              <h3>Report evidence</h3>
              {detail.reports.map((report) => (
                <article className="dispatch-history" key={report.id}>
                  <Badge value={report.severity} />
                  <small>
                    {when(report.observedAt)} · {human(report.source)}
                  </small>
                  <p className="dispatch-prose">{report.description}</p>
                  <small>
                    {report.location.latitude}, {report.location.longitude}
                  </small>
                  {report.photoObjectKey &&
                    (photos[report.id] ? (
                      <a
                        href={photos[report.id]}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open report photo ↗
                      </a>
                    ) : (
                      <button
                        className="button button-outline"
                        disabled={busy}
                        onClick={async () => {
                          setError("");
                          try {
                            const result = await api<{ url: string }>(
                              `/storage/download/${encodeURIComponent(report.photoObjectKey!)}`,
                            );
                            setPhotos((previous) => ({
                              ...previous,
                              [report.id]: result.url,
                            }));
                          } catch (failure) {
                            setError((failure as Error).message);
                          }
                        }}
                      >
                        View attached photo
                      </button>
                    ))}
                </article>
              ))}
            </>
          ) : (
            <p>
              Select an incident to inspect its evidence and coordinate
              maintenance.
            </p>
          )}
        </section>
      </div>
    </DispatchPage>
  );
}
