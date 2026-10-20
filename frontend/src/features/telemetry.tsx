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
import { Resource } from "./panels";

export function Telemetry() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <FormLayout
      eyebrow="OPERATIONS / PRESSURE MONITORING"
      title="Record a pressure reading"
      description="Choose a sensor and enter the measurement you took. The observation time is recorded automatically."
      help={
        <>
          <p>
            Choose a sensor by name. Enter pressure in <strong>bar</strong>,
            exactly as shown on your measuring device.
          </p>
          <p>
            Flow is optional. Leave it blank if you only measured pressure; zero
            means you observed no flow.
          </p>
        </>
      }
    >
      <form
        className="workflow-form"
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setError("");
          setMessage("");
          if (!data.get("sensorId")) {
            setError("Choose a sensor first.");
            return;
          }
          setBusy(true);
          try {
            await api("/telemetry/readings", {
              method: "POST",
              body: JSON.stringify({
                sensorId: data.get("sensorId"),
                pressureBar: Number(data.get("pressureBar")),
                ...(data.get("flowLitersPerSecond")
                  ? {
                      flowLitersPerSecond: Number(
                        data.get("flowLitersPerSecond"),
                      ),
                    }
                  : {}),
                source: "MANUAL",
                observedAt: new Date().toISOString(),
              }),
            });
            setMessage(
              "Reading recorded. Your measurement is now part of the sensor history.",
            );
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormSection number="01" title="Choose your sensor">
          <RecordPicker
            endpoint="/telemetry/sensors"
            label="Sensor"
            name="sensorId"
            disabled={busy}
          />
        </FormSection>
        <FormSection number="02" title="Enter your measurement">
          <div className="workflow-columns">
            <FormField
              label="Pressure (bar)"
              hint="For example, 2.4 means 2.4 bar."
            >
              <input
                name="pressureBar"
                type="number"
                min={0}
                max={9999.999}
                step="0.001"
                placeholder="e.g. 2.4"
                required
                disabled={busy}
              />
            </FormField>
            <FormField
              label="Flow (litres per second)"
              hint="Only fill this in if flow was measured."
              optional
            >
              <input
                name="flowLitersPerSecond"
                type="number"
                min={0}
                max={9999999.999}
                step="0.001"
                placeholder="e.g. 0.75"
                disabled={busy}
              />
            </FormField>
          </div>
        </FormSection>
        <FormFeedback error={error} message={message} />
        <FormActions busy={busy} label="Save reading" />
      </form>
      <div className="workflow-records">
        <Resource
          heading="Registered sensors"
          endpoint="/telemetry/sensors?limit=100&page=1"
          columns={[
            ["name", "Sensor"],
            ["type", "Type"],
            ["status", "Status"],
          ]}
        />
      </div>
    </FormLayout>
  );
}
