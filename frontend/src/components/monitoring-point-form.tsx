import { useState } from "react";
import { api } from "../lib/api";
import { FormField, FormFeedback, RecordPicker } from "./forms";
export function MonitoringPointForm({ onCreated }: { onCreated: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <details className="panel">
      <summary>Set up a monitoring point</summary>
      <p>
        Associate a named pressure observation point with a water point. Manual
        measurements do not require IoT hardware.
      </p>
      <form
        className="workflow-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget,
            data = new FormData(form);
          if (!data.get("standpipeId")) {
            setError("Choose a water point first.");
            return;
          }
          setBusy(true);
          setError("");
          setMessage("");
          try {
            await api("/telemetry/sensors", {
              method: "POST",
              body: JSON.stringify({
                name: data.get("name"),
                standpipeId: data.get("standpipeId"),
                type: "PRESSURE",
              }),
            });
            setMessage(
              "Monitoring point created. You can now record its measurements.",
            );
            form.reset();
            onCreated();
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormField label="Monitoring point name">
          <input
            name="name"
            required
            maxLength={120}
            disabled={busy}
            placeholder="e.g. Hermata market pressure observation"
          />
        </FormField>
        <RecordPicker
          endpoint="/public/standpipes"
          label="Water point"
          name="standpipeId"
          disabled={busy}
        />
        <FormFeedback error={error} message={message} />
        <button className="button button-primary" disabled={busy}>
          {busy ? "Saving…" : "Create monitoring point"}
        </button>
      </form>
    </details>
  );
}
