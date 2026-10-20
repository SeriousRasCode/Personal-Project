import { useEffect, useState } from "react";
import { api, getSession } from "../lib/api";
import {
  FormActions,
  FormFeedback,
  FormField,
  FormLayout,
  FormSection,
} from "../components/forms";
import { DataTable } from "../components/ui";

type Area = {
  id: string;
  name: string;
  code: string;
  population?: number | null;
  updatedAt: string;
};
export function GeographyAdmin() {
  const [rows, setRows] = useState<Area[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [remove, setRemove] = useState<Area | null>(null);
  const admin = getSession()?.user.role === "ADMIN";
  const load = () =>
    api<{ items: Area[] }>("/staff/geography/kebeles?limit=100&page=1")
      .then((result) => setRows(result.items))
      .catch((failure) => setError(failure.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <FormLayout
      eyebrow="ADMINISTRATION / SERVICE AREAS"
      title="Organise your service areas"
      description="Give each kebele a recognisable name and code so your team can find it easily."
      help={
        <>
          <p>
            <strong>Name</strong> is what your team sees in directories.{" "}
            <strong>Code</strong> is the short identifier used in your local
            records.
          </p>
          <p>
            Population and map coordinates are optional. You can add them later
            when you have accurate information.
          </p>
        </>
      }
    >
      {admin && (
        <form
          className="workflow-form"
          aria-busy={busy}
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            setError("");
            setMessage("");
            const lat = data.get("latitude"),
              lon = data.get("longitude");
            if (Boolean(lat) !== Boolean(lon)) {
              setError(
                "Enter both latitude and longitude, or leave both blank.",
              );
              return;
            }
            setBusy(true);
            try {
              await api("/kebeles", {
                method: "POST",
                body: JSON.stringify({
                  name: String(data.get("name")).trim(),
                  code: String(data.get("code")).trim(),
                  ...(data.get("population")
                    ? { population: Number(data.get("population")) }
                    : {}),
                  ...(lat && lon
                    ? {
                        center: {
                          latitude: Number(lat),
                          longitude: Number(lon),
                        },
                      }
                    : {}),
                }),
              });
              setMessage(
                "Service area created. It is now available to your team.",
              );
              form.reset();
              await load();
            } catch (failure) {
              setError((failure as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FormSection
            number="01"
            title="Name the area"
            description="Use the same name and code your team uses in local records."
          >
            <div className="workflow-columns">
              <FormField
                label="Service area name"
                hint="A name people will recognise."
              >
                <input
                  name="name"
                  placeholder="e.g. Hermata"
                  maxLength={120}
                  required
                  disabled={busy}
                />
              </FormField>
              <FormField label="Area code" hint="A short, unique identifier.">
                <input
                  name="code"
                  placeholder="e.g. JIM-04"
                  maxLength={30}
                  required
                  disabled={busy}
                />
              </FormField>
            </div>
          </FormSection>
          <details>
            <summary>
              Additional details{" "}
              <span className="optional-label">Optional</span>
            </summary>
            <div className="workflow-fields">
              <FormField
                label="Estimated population"
                hint="Leave blank if no reliable estimate is available."
                optional
              >
                <input
                  name="population"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="e.g. 12000"
                  disabled={busy}
                />
              </FormField>
              <div className="workflow-columns">
                <FormField
                  label="Centre latitude"
                  hint="Add both coordinates together."
                  optional
                >
                  <input
                    name="latitude"
                    type="number"
                    min={-90}
                    max={90}
                    step="any"
                    placeholder="e.g. 7.6731"
                    disabled={busy}
                  />
                </FormField>
                <FormField label="Centre longitude" optional>
                  <input
                    name="longitude"
                    type="number"
                    min={-180}
                    max={180}
                    step="any"
                    placeholder="e.g. 36.8351"
                    disabled={busy}
                  />
                </FormField>
              </div>
            </div>
          </details>
          <FormFeedback error={error} message={message} />
          <FormActions busy={busy} label="Create service area" />
        </form>
      )}
      <section className="panel workflow-records">
        <div className="workflow-card-header">
          <h2>Your service areas</h2>
          <span className="workflow-count">{rows.length} shown</span>
        </div>
        {!admin && <FormFeedback error={error} message={message} />}
        <DataTable
          rows={rows}
          columns={[
            ["name", "Service area"],
            ["code", "Code"],
          ]}
          action={
            admin
              ? (row) => (
                  <button
                    type="button"
                    className="button button-outline workflow-danger"
                    onClick={() => setRemove(row as Area)}
                  >
                    Delete
                  </button>
                )
              : undefined
          }
        />
        {remove && (
          <div
            className="workflow-confirm"
            role="group"
            aria-label="Confirm service area deletion"
          >
            <p>
              Delete <strong>{remove.name}</strong>? This removes the
              service-area record. The backend may refuse deletion if it is
              still in use.
            </p>
            <button
              className="button button-outline"
              type="button"
              onClick={() => setRemove(null)}
              disabled={busy}
            >
              Keep area
            </button>
            <button
              className="button button-primary workflow-danger"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api(`/kebeles/${remove.id}`, { method: "DELETE" });
                  setRemove(null);
                  setMessage("Service area deleted.");
                  await load();
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete area
            </button>
          </div>
        )}
      </section>
    </FormLayout>
  );
}
