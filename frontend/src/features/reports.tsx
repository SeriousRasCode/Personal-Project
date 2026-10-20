import { useState } from "react";
import { api } from "../lib/api";
import { Button, Field, Panel } from "../components/ui";

export function Reports() {
  const [kind, setKind] = useState("flow");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Make a report">
      <div className="segmented" aria-label="Report type">
        {["flow", "queue", "leak"].map((value) => (
          <button
            key={value}
            type="button"
            data-tour-variant={value}
            className={kind === value ? "selected" : ""}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setMessage("");
              setError("");
            }}
          >
            {value === "flow"
              ? "Water flow"
              : value === "queue"
                ? "Queue wait"
                : "Suspected leak"}
          </button>
        ))}
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const body =
            kind === "flow"
              ? {
                  standpipeId: data.get("standpipeId"),
                  status: data.get("status"),
                }
              : kind === "queue"
                ? {
                    standpipeId: data.get("standpipeId"),
                    waitMinutes: Number(data.get("waitMinutes")),
                  }
                : {
                    description: data.get("description"),
                    severity: data.get("severity"),
                    location: {
                      latitude: Number(data.get("latitude")),
                      longitude: Number(data.get("longitude")),
                    },
                  };
          setBusy(true);
          setError("");
          try {
            await api(
              kind === "flow"
                ? "/reports/tap-status"
                : kind === "queue"
                  ? "/reports/queue-wait"
                  : "/leaks/reports",
              { method: "POST", body: JSON.stringify(body) },
            );
            setMessage("Report recorded. Thank you for sharing an update.");
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        aria-busy={busy}
      >
        {kind !== "leak" && (
          <Field label="Standpipe ID">
            <input name="standpipeId" required disabled={busy} />
          </Field>
        )}
        {kind === "flow" && (
          <Field label="Flow status">
            <select name="status" disabled={busy}>
              <option>FULL_FLOW</option>
              <option>TRICKLE</option>
              <option>DRY</option>
            </select>
          </Field>
        )}
        {kind === "queue" && (
          <Field label="Wait minutes">
            <input
              name="waitMinutes"
              type="number"
              min={0}
              required
              disabled={busy}
            />
          </Field>
        )}
        {kind === "leak" && (
          <>
            <Field label="Description">
              <textarea
                name="description"
                required
                minLength={10}
                disabled={busy}
              />
            </Field>
            <Field label="Severity">
              <select name="severity" disabled={busy}>
                <option>LOW</option>
                <option>MEDIUM</option>
                <option>HIGH</option>
                <option>CRITICAL</option>
              </select>
            </Field>
            <Field label="Latitude">
              <input
                name="latitude"
                type="number"
                step="any"
                min={-90}
                max={90}
                required
                disabled={busy}
              />
            </Field>
            <Field label="Longitude">
              <input
                name="longitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                required
                disabled={busy}
              />
            </Field>
          </>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        <Button disabled={busy}>
          {busy ? "Sending report…" : "Submit report"}
        </Button>
      </form>
    </Panel>
  );
}
