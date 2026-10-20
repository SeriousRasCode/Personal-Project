import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { FormFeedback, FormLayout } from "../components/forms";
import { DataTable } from "../components/ui";
type Valve = {
  id: string;
  name: string;
  code: string;
  isOpen: boolean;
  position: string;
  updatedAt: string;
};
export function ValveControls() {
  const [rows, setRows] = useState<Valve[]>([]),
    [selected, setSelected] = useState<Valve | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = () =>
    api<{ items: Valve[] }>("/maintenance/valves?limit=100&page=1")
      .then((result) => setRows(result.items))
      .catch((failure) => setError(failure.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <FormLayout
      eyebrow="OPERATIONS / VALVE CONTROLS"
      title="Manage valve positions"
      description="Review a valve’s current position, then choose the action beside that valve."
      help={
        <>
          <p>
            Check the valve name and code carefully. Changing a position is an
            operational action.
          </p>
          <p>
            You’ll review the selected valve before confirming. If another
            person changes it first, refresh the record before trying again.
          </p>
        </>
      }
    >
      <section className="panel">
        <div className="workflow-card-header">
          <h2>Network valves</h2>
          <button
            className="button button-outline"
            onClick={load}
            disabled={busy}
          >
            Refresh
          </button>
        </div>
        <FormFeedback error={error} message={message} />
        <DataTable
          rows={rows}
          columns={[
            ["name", "Valve"],
            ["code", "Code"],
            ["position", "Current position"],
          ]}
          action={(row) => (
            <button
              className="button button-outline"
              disabled={busy}
              onClick={() => setSelected(row as Valve)}
            >
              {row.isOpen ? "Close valve" : "Open valve"}
            </button>
          )}
        />
        {selected && (
          <div
            className="workflow-confirm"
            role="group"
            aria-label="Confirm valve operation"
          >
            <p>
              <strong>
                {selected.isOpen ? "Close" : "Open"} {selected.name}
              </strong>{" "}
              ({selected.code})? Its current position is{" "}
              {selected.isOpen ? "open" : "closed"}.
            </p>
            <button
              className="button button-outline"
              onClick={() => setSelected(null)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                setMessage("");
                try {
                  await api(`/maintenance/valves/${selected.id}/state`, {
                    method: "POST",
                    body: JSON.stringify({
                      isOpen: !selected.isOpen,
                      expectedUpdatedAt: selected.updatedAt,
                    }),
                  });
                  setMessage(
                    `${selected.name} was ${selected.isOpen ? "closed" : "opened"}.`,
                  );
                  setSelected(null);
                  await load();
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm {selected.isOpen ? "close" : "open"}
            </button>
          </div>
        )}
      </section>
    </FormLayout>
  );
}
