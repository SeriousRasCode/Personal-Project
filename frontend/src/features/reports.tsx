import { useState } from "react";
import { api } from "../lib/api";
import {
  FormActions,
  FormFeedback,
  FormField,
  FormLayout,
  FormSection,
  RecordPicker,
} from "../components/forms";

export function Reports() {
  const [kind, setKind] = useState("flow");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [location, setLocation] = useState({ latitude: "", longitude: "" });
  function locate() {
    if (!navigator.geolocation) {
      setError("Location is unavailable. You can enter coordinates manually.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
        });
        setLocating(false);
      },
      () => {
        setError(
          "Could not get your location. Check location permissions or enter coordinates manually.",
        );
        setLocating(false);
      },
      { timeout: 10000 },
    );
  }
  return (
    <FormLayout
      eyebrow="COMMUNITY / SHARE AN UPDATE"
      title="What are you seeing?"
      description="A quick observation can help someone plan their day—and help the team respond."
      help={
        <>
          <p>
            Choose the kind of update, then fill in what you know. A water point
            can be selected by name; you don’t need its ID.
          </p>
          <p>
            For a suspected leak, describe the nearest landmark and check the
            location before sending.
          </p>
        </>
      }
    >
      <div className="workflow-segmented" aria-label="Report type">
        {[
          {
            id: "flow",
            title: "Water flow",
            hint: "Flowing, trickling or dry",
          },
          {
            id: "queue",
            title: "Queue wait",
            hint: "Help others plan their visit",
          },
          {
            id: "leak",
            title: "Suspected leak",
            hint: "Help the team find an issue",
          },
        ].map((tab) => (
          <button
            type="button"
            key={tab.id}
            data-tour-variant={tab.id}
            className={kind === tab.id ? "selected" : ""}
            aria-pressed={kind === tab.id}
            onClick={() => {
              setKind(tab.id);
              setError("");
              setMessage("");
            }}
            disabled={busy}
          >
            <strong>{tab.title}</strong>
            <small>{tab.hint}</small>
          </button>
        ))}
      </div>
      <form
        className="workflow-form"
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setError("");
          setMessage("");
          if (kind !== "leak" && !data.get("standpipeId")) {
            setError("Choose a water point before submitting your report.");
            return;
          }
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
                    ...(data.get("queueSize")
                      ? { queueSize: Number(data.get("queueSize")) }
                      : {}),
                  }
                : {
                    description: data.get("description"),
                    severity: data.get("severity"),
                    location: {
                      latitude: Number(location.latitude),
                      longitude: Number(location.longitude),
                    },
                  };
          setBusy(true);
          try {
            await api(
              kind === "flow"
                ? "/reports/tap-status"
                : kind === "queue"
                  ? "/reports/queue-wait"
                  : "/leaks/reports",
              { method: "POST", body: JSON.stringify(body) },
            );
            setMessage(
              "Your report has been recorded. Thank you for keeping your community informed.",
            );
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {kind !== "leak" ? (
          <>
            <FormSection
              number="01"
              title="Choose the water point"
              description="Find the location where you made your observation."
            >
              <RecordPicker
                endpoint="/public/standpipes"
                label="Water point"
                name="standpipeId"
                disabled={busy}
              />
            </FormSection>
            <FormSection
              number="02"
              title={
                kind === "flow"
                  ? "Describe the water flow"
                  : "Estimate the queue"
              }
            >
              {kind === "flow" ? (
                <FormField
                  label="How is the water flowing?"
                  hint="Choose the condition you observed on your visit."
                >
                  <select name="status" disabled={busy}>
                    <option value="FULL_FLOW">Flowing normally</option>
                    <option value="TRICKLE">A small trickle</option>
                    <option value="DRY">No water / dry</option>
                  </select>
                </FormField>
              ) : (
                <div className="workflow-columns">
                  <FormField
                    label="Estimated wait"
                    hint="Enter the number of minutes a person is likely to wait."
                  >
                    <input
                      name="waitMinutes"
                      type="number"
                      min={0}
                      max={1440}
                      placeholder="e.g. 15"
                      required
                      disabled={busy}
                    />
                  </FormField>
                  <FormField
                    label="People in the queue"
                    hint="Leave blank if you’re unsure."
                    optional
                  >
                    <input
                      name="queueSize"
                      type="number"
                      min={0}
                      max={10000}
                      placeholder="e.g. 8"
                      disabled={busy}
                    />
                  </FormField>
                </div>
              )}
            </FormSection>
          </>
        ) : (
          <>
            <FormSection number="01" title="Tell us what happened">
              <FormField
                label="What can you see?"
                hint="Include a nearby landmark so the team can find it."
              >
                <textarea
                  name="description"
                  minLength={10}
                  maxLength={2000}
                  placeholder="e.g. Water is leaking beside the school gate near the main road."
                  required
                  disabled={busy}
                />
              </FormField>
              <FormField
                label="How serious does it look?"
                hint="The response team will review your observation."
              >
                <select name="severity" defaultValue="MEDIUM" disabled={busy}>
                  <option value="LOW">Low — small seepage</option>
                  <option value="MEDIUM">Medium — a visible leak</option>
                  <option value="HIGH">High — substantial water loss</option>
                  <option value="CRITICAL">
                    Critical — severe flooding or danger
                  </option>
                </select>
              </FormField>
            </FormSection>
            <FormSection
              number="02"
              title="Locate the issue"
              description="Use your location only if you are at the leak. Otherwise enter its coordinates."
            >
              <button
                className="button button-outline"
                type="button"
                onClick={locate}
                disabled={busy || locating}
              >
                {locating
                  ? "Finding your location…"
                  : "Use my current location"}
              </button>
              <div className="workflow-columns">
                <FormField label="Latitude" hint="North–south coordinate.">
                  <input
                    name="latitude"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    required
                    value={location.latitude}
                    onChange={(event) =>
                      setLocation({ ...location, latitude: event.target.value })
                    }
                    disabled={busy}
                    placeholder="e.g. 7.6731"
                  />
                </FormField>
                <FormField label="Longitude" hint="East–west coordinate.">
                  <input
                    name="longitude"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    required
                    value={location.longitude}
                    onChange={(event) =>
                      setLocation({
                        ...location,
                        longitude: event.target.value,
                      })
                    }
                    disabled={busy}
                    placeholder="e.g. 36.8351"
                  />
                </FormField>
              </div>
            </FormSection>
          </>
        )}
        <FormFeedback error={error} message={message} />
        <FormActions busy={busy} label="Send report" />
      </form>
    </FormLayout>
  );
}
