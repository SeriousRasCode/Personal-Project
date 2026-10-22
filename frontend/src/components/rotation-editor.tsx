import { useState, useContext } from "react";
import { TourDemoContext } from "../lib/tour-demo";
import { api } from "../lib/api";
import { localDateTime } from "../lib/dispatch";
import type { Rotation, RotationWindow } from "../lib/rotations";
import { FormField, FormFeedback, RecordPicker } from "./forms";
export function RotationEditor({
  rotation,
  onSaved,
  onCancel,
}: {
  rotation?: Rotation;
  onSaved: (record: Rotation) => void;
  onCancel: () => void;
}) {
  const demo = useContext(TourDemoContext);
  const [area, setArea] = useState(rotation?.kebeleId || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [windows, setWindows] = useState<RotationWindow[]>(
    rotation?.windows.map((window) => ({
      ...window,
      startsAt: localDateTime(window.startsAt),
      endsAt: localDateTime(window.endsAt),
    })) || [
      {
        id: crypto.randomUUID(),
        standpipeId: null,
        startsAt: "",
        endsAt: "",
        status: "SCHEDULED",
        updatedAt: "",
      },
    ],
  );
  return (
    <form
      className="workflow-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (demo) return;
        const data = new FormData(event.currentTarget);
        setError("");
        if (!area || !windows.length) {
          setError("Choose a service area and add at least one window.");
          return;
        }
        if (windows.some((window) => !data.has(window.id + "-point"))) {
          setError("Wait for the water-point options to load before saving.");
          return;
        }
        const entries = windows.map((window) => ({
          startsAt: new Date(
            String(data.get(window.id + "-start")),
          ).toISOString(),
          endsAt: new Date(String(data.get(window.id + "-end"))).toISOString(),
          standpipeId: data.get(window.id + "-point") || null,
          minimumPressureBar: data.get(window.id + "-min")
            ? Number(data.get(window.id + "-min"))
            : null,
          maximumPressureBar: data.get(window.id + "-max")
            ? Number(data.get(window.id + "-max"))
            : null,
          notes: data.get(window.id + "-notes") || null,
        }));
        if (entries.some((window) => window.endsAt <= window.startsAt)) {
          setError("Every window must close after it opens.");
          return;
        }
        setBusy(true);
        try {
          const saved = await api<Rotation>(
            rotation ? `/schedules/${rotation.id}` : "/schedules",
            {
              method: rotation ? "PATCH" : "POST",
              body: JSON.stringify({
                kebeleId: area,
                name: data.get("name"),
                startsOn: data.get("startsOn"),
                endsOn: data.get("endsOn"),
                notes: data.get("notes") || null,
                windows: entries,
                ...(rotation ? { updatedAt: rotation.updatedAt } : {}),
              }),
            },
          );
          onSaved(saved);
        } catch (failure) {
          setError((failure as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{rotation ? "Edit draft rotation" : "Plan a rotation"}</h2>
      <FormField label="Schedule name">
        <input
          name="name"
          defaultValue={rotation?.name}
          required
          maxLength={160}
          disabled={busy}
        />
      </FormField>
      <RecordPicker
        endpoint="/kebeles"
        label="Service area"
        name="kebeleId"
        initialValue={area}
        onChange={(value) => {
          setArea(value);
          setWindows((previous) =>
            previous.map((window) => ({ ...window, standpipeId: null })),
          );
        }}
        disabled={busy}
      />
      <div className="workflow-columns">
        <FormField label="First service date">
          <input
            type="date"
            name="startsOn"
            defaultValue={rotation?.startsOn.slice(0, 10)}
            required
            disabled={busy}
          />
        </FormField>
        <FormField label="Last service date">
          <input
            type="date"
            name="endsOn"
            defaultValue={rotation?.endsOn.slice(0, 10)}
            required
            disabled={busy}
          />
        </FormField>
      </div>
      <FormField label="Planning notes" optional>
        <textarea
          name="notes"
          defaultValue={rotation?.notes || ""}
          maxLength={4000}
          disabled={busy}
        />
      </FormField>
      <p>
        Times use your device time zone (
        {Intl.DateTimeFormat().resolvedOptions().timeZone}). Midnight windows
        may end the following day. Overlaps are checked by the server.
      </p>
      {windows.map((window, index) => (
        <fieldset className="dispatch-window" key={window.id}>
          <legend>Service window {index + 1}</legend>
          <div className="workflow-columns">
            <FormField label="Opens">
              <input
                name={window.id + "-start"}
                type="datetime-local"
                defaultValue={window.startsAt}
                required
                disabled={busy}
              />
            </FormField>
            <FormField label="Closes">
              <input
                name={window.id + "-end"}
                type="datetime-local"
                defaultValue={window.endsAt}
                required
                disabled={busy}
              />
            </FormField>
          </div>
          {area && (
            <RecordPicker
              key={window.id + area}
              endpoint={`/public/standpipes?kebeleId=${area}`}
              name={window.id + "-point"}
              label="Specific water point"
              hint="Leave blank for kebele-wide service."
              required={false}
              initialValue={window.standpipeId || ""}
              disabled={busy}
            />
          )}
          <div className="workflow-columns">
            <FormField label="Minimum pressure (bar)" optional>
              <input
                name={window.id + "-min"}
                type="number"
                min={0}
                max={9999.999}
                step="0.001"
                defaultValue={window.minimumPressureBar ?? ""}
                disabled={busy}
              />
            </FormField>
            <FormField label="Maximum pressure (bar)" optional>
              <input
                name={window.id + "-max"}
                type="number"
                min={0}
                max={9999.999}
                step="0.001"
                defaultValue={window.maximumPressureBar ?? ""}
                disabled={busy}
              />
            </FormField>
          </div>
          <FormField label="Window notes" optional>
            <input
              name={window.id + "-notes"}
              maxLength={2000}
              defaultValue={window.notes || ""}
              disabled={busy}
            />
          </FormField>
          <button
            className="button button-outline"
            type="button"
            disabled={busy || windows.length <= 1}
            onClick={() =>
              setWindows((previous) =>
                previous.filter((item) => item.id !== window.id),
              )
            }
          >
            Remove window
          </button>
        </fieldset>
      ))}
      <button
        className="button button-outline"
        type="button"
        disabled={busy || windows.length >= 500}
        onClick={() =>
          setWindows((previous) => [
            ...previous,
            {
              id: crypto.randomUUID(),
              standpipeId: null,
              startsAt: "",
              endsAt: "",
              status: "SCHEDULED",
              updatedAt: "",
            },
          ])
        }
      >
        Add service window
      </button>
      <FormFeedback error={error} />
      <div className="dispatch-toolbar">
        <button className="button button-primary" disabled={busy}>
          {busy ? "Saving…" : "Save draft"}
        </button>
        <button
          className="button button-outline"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
