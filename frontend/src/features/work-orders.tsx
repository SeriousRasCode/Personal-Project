import { useEffect, useState } from "react";
import { api, getSession } from "../lib/api";
import { canPerform } from "../lib/permissions";
import {
  human,
  orderActions,
  when,
  type WorkOrder,
  type Page,
} from "../lib/dispatch";
import { useCollection } from "../lib/use-collection";
import { Badge, DispatchPage, Pager } from "../components/dispatch-ui";
import { FormField, FormFeedback } from "../components/forms";
import { AssigneeField, WorkOrderForm } from "../components/work-order-form";
export function WorkOrders() {
  const [page, setPage] = useState(1),
    [status, setStatus] = useState("");
  const data = useCollection<WorkOrder>(
    `/work-orders?page=${page}&limit=20${status ? "&status=" + status : ""}`,
  );
  const [selected, setSelected] = useState<WorkOrder | null>(null),
    [editing, setEditing] = useState(false),
    [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<
      { id: string; toStatus: string; note: string | null; createdAt: string }[]
    >([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const session = getSession()!,
    manage = canPerform("work-order.manage", session);
  async function open(id: string) {
    setError("");
    setBusy(true);
    try {
      const [order, activities] = await Promise.all([
        api<WorkOrder>(`/work-orders/${id}`),
        api<Page<(typeof history)[number]>>(
          `/work-orders/${id}/activities?limit=100`,
        ),
      ]);
      setSelected(order);
      setHistory(activities.items);
      setEditing(false);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const id = sessionStorage.getItem("hydrojimma.open-order");
    if (id) {
      sessionStorage.removeItem("hydrojimma.open-order");
      void open(id);
    }
  }, []);
  return (
    <DispatchPage
      title="Maintenance work orders"
      description="Assign repairs, follow field progress and keep a clear service history."
    >
      <div className="dispatch-toolbar">
        <FormField label="Order status">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {[
              "OPEN",
              "ASSIGNED",
              "ACKNOWLEDGED",
              "IN_PROGRESS",
              "ON_HOLD",
              "COMPLETED",
              "CANCELLED",
            ].map((s) => (
              <option key={s} value={s}>
                {human(s)}
              </option>
            ))}
          </select>
        </FormField>
        <button className="button button-outline" onClick={data.reload}>
          Refresh
        </button>
        {manage && (
          <button
            className="button button-primary"
            onClick={() => setCreating(true)}
          >
            New work order
          </button>
        )}
      </div>
      <FormFeedback error={error || data.error} message={message} />
      {creating && (
        <WorkOrderForm
          onCancel={() => setCreating(false)}
          onSaved={(order) => {
            setCreating(false);
            setSelected(order);
            setHistory([]);
            setMessage("Work order created.");
            void data.reload();
          }}
        />
      )}
      <div className="dispatch-split">
        <section className="panel">
          <h2>Repair queue</h2>
          {data.loading && <p role="status">Loading work orders…</p>}
          <div className="dispatch-list">
            {data.items.map((order) => (
              <button
                className={`dispatch-record ${selected?.id === order.id ? "is-selected" : ""}`}
                key={order.id}
                onClick={() => void open(order.id)}
                disabled={busy}
              >
                <strong>{order.title}</strong>
                <span>
                  {order.code} · {order.assignee?.displayName || "Unassigned"}
                </span>
                <Badge value={order.status} />
                <small>
                  {human(order.priority)} priority · {when(order.scheduledFor)}
                </small>
              </button>
            ))}
          </div>
          {!data.loading && !data.items.length && (
            <p>No orders match this filter.</p>
          )}
          <Pager page={page} pages={data.meta?.totalPages} onChange={setPage} />
        </section>
        <section className="panel" aria-label="Work order details">
          {selected ? (
            <>
              {editing ? (
                <WorkOrderForm
                  key={selected.id + selected.updatedAt}
                  order={selected}
                  onCancel={() => setEditing(false)}
                  onSaved={(order) => {
                    setSelected(order);
                    setEditing(false);
                    setMessage("Assignment and repair details saved.");
                    void data.reload();
                  }}
                />
              ) : (
                <>
                  <p className="eyebrow">{selected.code}</p>
                  <h2>{selected.title}</h2>
                  <Badge value={selected.status} />
                  <p className="dispatch-prose">{selected.description}</p>
                  <p>
                    Assigned to:{" "}
                    <strong>
                      {selected.assignee?.displayName || "Unassigned"}
                    </strong>
                  </p>
                  <p>Scheduled: {when(selected.scheduledFor)}</p>
                  {manage &&
                    !["COMPLETED", "CANCELLED"].includes(selected.status) && (
                      <button
                        className="button button-outline"
                        onClick={() => setEditing(true)}
                      >
                        Edit details / assignment
                      </button>
                    )}
                  {orderActions(selected, session.user.role, session.user.id)
                    .length > 0 && (
                    <form
                      className="workflow-form"
                      key={selected.id + selected.updatedAt}
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        setBusy(true);
                        setError("");
                        try {
                          await api(`/work-orders/${selected.id}/status`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              status: form.get("status"),
                              note: form.get("note") || null,
                              expectedUpdatedAt: selected.updatedAt,
                              ...(form.get("assignedToId")
                                ? { assignedToId: form.get("assignedToId") }
                                : {}),
                            }),
                          });
                          await open(selected.id);
                          await data.reload();
                          setMessage("Work order status updated.");
                        } catch (failure) {
                          setError((failure as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <h3>Update progress</h3>
                      <FormField label="Next status">
                        <select name="status">
                          {orderActions(
                            selected,
                            session.user.role,
                            session.user.id,
                          ).map((s) => (
                            <option key={s} value={s}>
                              {human(s)}
                            </option>
                          ))}
                        </select>
                      </FormField>
                      {selected.status === "OPEN" && manage && (
                        <AssigneeField />
                      )}
                      <FormField
                        label="Progress / resolution note"
                        hint="A resolution note is required to complete a repair."
                      >
                        <textarea name="note" maxLength={2000} />
                      </FormField>
                      <button className="button button-primary" disabled={busy}>
                        Save progress
                      </button>
                    </form>
                  )}
                  <h3>Activity history</h3>
                  {history.map((item) => (
                    <article className="dispatch-history" key={item.id}>
                      <Badge value={item.toStatus} />
                      <small>{when(item.createdAt)}</small>
                      <p>{item.note || "Status updated"}</p>
                    </article>
                  ))}
                  {!history.length && <p>No activity recorded yet.</p>}
                </>
              )}
            </>
          ) : (
            <p>
              Select a work order to inspect its assignment, progress and
              history.
            </p>
          )}
        </section>
      </div>
    </DispatchPage>
  );
}
