import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { FormFeedback, RecordPicker } from "./forms";
export function WaterAlertArea() {
  const [area, setArea] = useState<string | null>(null),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    api<{ kebeleId: string | null }>("/notifications/water-area")
      .then((result) => {
        if (active) {
          setArea(result.kebeleId);
          setLoaded(true);
        }
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="panel">
      <h2>Your water-alert area</h2>
      <p>
        Choose the kebele where you want opening and closing alerts. This also
        sets the area used by your phone-based USSD service.
      </p>
      <FormFeedback error={error} message={message} />
      {loaded && (
        <form
          className="workflow-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            try {
              await api("/notifications/water-area", {
                method: "PATCH",
                body: JSON.stringify({ kebeleId: area || null }),
              });
              setMessage(
                area
                  ? "Water-alert area saved. Enable your preferred delivery channels below."
                  : "Water-alert area removed.",
              );
            } catch (failure) {
              setError((failure as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RecordPicker
            endpoint="/kebeles"
            label="Water-alert service area"
            name="alertArea"
            initialValue={area || ""}
            onChange={setArea}
            required={false}
            disabled={busy}
          />
          <button className="button button-primary" disabled={busy}>
            {busy ? "Saving…" : "Save water-alert area"}
          </button>
        </form>
      )}
    </section>
  );
}
