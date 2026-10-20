import { useState, useEffect } from "react";
import { api, getSession } from "../lib/api";
import { canPerform } from "../lib/permissions";
import { human, when } from "../lib/dispatch";
import { scheduleActions, windowAction, type Rotation } from "../lib/rotations";
import { useCollection } from "../lib/use-collection";
import { DispatchPage, Badge, Pager } from "../components/dispatch-ui";
import { FormField, FormFeedback } from "../components/forms";
import { RotationEditor } from "../components/rotation-editor";
export function Schedules() {
  const manage = canPerform("schedule.manage", getSession());
  const [page, setPage] = useState(1),
    [date, setDate] = useState(""),
    [status, setStatus] = useState(""),
    [selected, setSelected] = useState<Rotation | null>(null),
    [editor, setEditor] = useState<Rotation | "new" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const data = useCollection<Rotation>(
    `${manage ? "/schedules/staff" : "/schedules"}?limit=20&page=${page}${date ? "&from=" + date + "&to=" + date : ""}${status ? "&status=" + status : ""}`,
    30000,
  );
  useEffect(() => {
    if (!selected || busy || editor) return;
    let active = true;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void api<Rotation>(
        `${manage ? "/schedules/staff" : "/schedules"}/${selected.id}`,
      )
        .then((record) => {
          if (active) setSelected(record);
        })
        .catch((failure) => {
          if (active) setError(failure.message);
        });
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selected?.id, busy, editor, manage]);
  async function reloadSelection(id: string) {
    setSelected(
      await api<Rotation>(
        `${manage ? "/schedules/staff" : "/schedules"}/${id}`,
      ),
    );
    await data.reload();
  }
  return (
    <DispatchPage
      title="Water rotations"
      description="Plan service windows, review the agenda and record opening or closing operations."
    >
      <div className="dispatch-toolbar">
        <FormField label="Service date">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
        </FormField>
        <FormField label="Schedule status">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All available</option>
            {(manage
              ? ["DRAFT", "PUBLISHED", "ACTIVE", "COMPLETED", "CANCELLED"]
              : ["PUBLISHED", "ACTIVE"]
            ).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </FormField>
        <button
          className="button button-outline"
          onClick={() => {
            if (selected)
              void reloadSelection(selected.id).catch((failure) =>
                setError(failure.message),
              );
            else void data.reload();
          }}
        >
          Refresh
        </button>
        {manage && (
          <button
            className="button button-primary"
            onClick={() => setEditor("new")}
          >
            New rotation
          </button>
        )}
      </div>
      <FormFeedback error={error || data.error} message={message} />
      {editor && (
        <RotationEditor
          key={editor === "new" ? "new" : editor.id + editor.updatedAt}
          rotation={editor === "new" ? undefined : editor}
          onCancel={() => setEditor(null)}
          onSaved={(record) => {
            setSelected(record);
            setEditor(null);
            setMessage(
              "Draft saved. Review the service windows before publishing.",
            );
            void data.reload();
          }}
        />
      )}
      <div className="dispatch-split">
        <section className="panel">
          <h2>Rotation agenda</h2>
          {data.loading && <p role="status">Loading rotations…</p>}
          <div className="dispatch-list">
            {data.items.map((record) => (
              <button
                className={`dispatch-record ${selected?.id === record.id ? "is-selected" : ""}`}
                key={record.id}
                onClick={() => {
                  setSelected(record);
                  setError("");
                }}
              >
                <strong>{record.name}</strong>
                <span>
                  {record.kebele?.name} · {record.startsOn.slice(0, 10)} –{" "}
                  {record.endsOn.slice(0, 10)}
                </span>
                <Badge value={record.status} />
                <small>{record.windows.length} service windows</small>
              </button>
            ))}
          </div>
          {!data.loading && !data.items.length && (
            <p>No rotations match this date and status.</p>
          )}
          <Pager page={page} pages={data.meta?.totalPages} onChange={setPage} />
        </section>
        <section className="panel">
          {selected ? (
            <>
              <h2>{selected.name}</h2>
              <p>
                {selected.kebele?.name} · <Badge value={selected.status} />
              </p>
              <p className="dispatch-prose">{selected.notes}</p>
              {manage && (
                <div className="dispatch-toolbar">
                  {selected.status === "DRAFT" && (
                    <button
                      className="button button-outline"
                      onClick={() => setEditor(selected)}
                    >
                      Edit draft / windows
                    </button>
                  )}
                  {(scheduleActions[selected.status] || []).map((action) => (
                    <button
                      key={action}
                      className="button button-outline"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          const result = await api<Rotation>(
                            `/schedules/${selected.id}/${action}`,
                            {
                              method: "POST",
                              body: JSON.stringify({
                                updatedAt: selected.updatedAt,
                              }),
                            },
                          );
                          setSelected(result);
                          await data.reload();
                          setMessage(`Schedule ${action} action completed.`);
                        } catch (failure) {
                          setError((failure as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {human(action)}
                    </button>
                  ))}
                </div>
              )}
              <h3>Service windows</h3>
              {[...selected.windows]
                .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                .map((window) => (
                  <article className="dispatch-window" key={window.id}>
                    <h3>{window.standpipe?.name || "Entire service area"}</h3>
                    <Badge value={window.status} />
                    <p>
                      {when(window.startsAt)} → {when(window.endsAt)}
                    </p>
                    <p>
                      Pressure target: {window.minimumPressureBar ?? "—"} –{" "}
                      {window.maximumPressureBar ?? "—"} bar
                    </p>
                    {window.notes && <p>{window.notes}</p>}
                    {manage && windowAction(selected, window) && (
                      <button
                        className="button button-primary"
                        disabled={busy}
                        onClick={async () => {
                          const action = windowAction(selected, window);
                          if (!action) return;
                          setBusy(true);
                          setError("");
                          try {
                            await api(
                              `/schedules/${selected.id}/windows/${window.id}/${action}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  updatedAt: window.updatedAt,
                                }),
                              },
                            );
                            await reloadSelection(selected.id);
                            setMessage(`Window ${action} operation recorded.`);
                          } catch (failure) {
                            setError((failure as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {windowAction(selected, window) === "open"
                          ? "Record water opening"
                          : "Record water closing"}
                      </button>
                    )}
                  </article>
                ))}
              {manage && (
                <p>
                  Window controls appear only during their scheduled time and in
                  a valid state. These record utility operations; they do not
                  confirm a physical remote valve actuator.
                </p>
              )}
            </>
          ) : (
            <p>
              Select a rotation to see its service windows and next available
              actions.
            </p>
          )}
        </section>
      </div>
    </DispatchPage>
  );
}
