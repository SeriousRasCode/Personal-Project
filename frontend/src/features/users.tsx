import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  FormActions,
  FormFeedback,
  FormField,
  FormLayout,
  FormSection,
} from "../components/forms";
import { DataTable } from "../components/ui";

type Person = {
  id: string;
  displayName: string;
  phone: string;
  role: string;
  status: string;
};
const statuses = [
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "DEACTIVATED", label: "Deactivated" },
  { value: "PENDING_VERIFICATION", label: "Awaiting verification" },
];
export function UserAdministration() {
  const [rows, setRows] = useState<Person[]>([]),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = () =>
    api<{ items: Person[] }>("/users?limit=100&page=1")
      .then((result) => setRows(result.items))
      .catch((failure) => setError(failure.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <FormLayout
      eyebrow="ADMINISTRATION / PEOPLE & ACCESS"
      title="Keep your team connected"
      description="Create a staff account or update access beside the person it belongs to."
      help={
        <>
          <p>
            Choose the role that matches this person’s responsibilities. Their
            role determines which tools they can use.
          </p>
          <p>
            Status changes affect access. Choose a status in the directory, then
            press <strong>Save</strong> to apply it.
          </p>
        </>
      }
    >
      <form
        className="workflow-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          setBusy(true);
          setError("");
          setMessage("");
          try {
            await api("/users/staff", {
              method: "POST",
              body: JSON.stringify({
                displayName: String(data.get("displayName")).trim(),
                phone: String(data.get("phone")).trim(),
                password: data.get("password"),
                role: data.get("role"),
                status: "ACTIVE",
              }),
            });
            form.reset();
            setMessage(
              "Staff account created. Share their sign-in details through your normal secure process.",
            );
            await load();
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        aria-busy={busy}
      >
        <FormSection number="01" title="Who is joining the team?">
          <FormField label="Full name">
            <input
              name="displayName"
              placeholder="e.g. Abdi Mohammed"
              autoComplete="off"
              required
              maxLength={120}
              disabled={busy}
            />
          </FormField>
          <div className="workflow-columns">
            <FormField label="Phone number" hint="Include the country code.">
              <input
                name="phone"
                type="tel"
                placeholder="+251900000105"
                required
                disabled={busy}
              />
            </FormField>
            <FormField
              label="Team role"
              hint="Choose the access this person needs."
            >
              <select name="role" required disabled={busy}>
                <option value="FIELD_TECHNICIAN">Field technician</option>
                <option value="STANDPIPE_OPERATOR">Standpipe operator</option>
                <option value="DISPATCHER">Dispatcher</option>
                <option value="ADMIN">Administrator</option>
              </select>
            </FormField>
          </div>
        </FormSection>
        <FormSection number="02" title="Set their sign-in password">
          <FormField
            label="Initial password"
            hint="Use a unique password with upper- and lowercase letters, a number and a symbol."
          >
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              disabled={busy}
              placeholder="Choose a strong, unique password"
            />
          </FormField>
        </FormSection>
        <FormFeedback error={error} message={message} />
        <FormActions busy={busy} label="Create staff account" />
      </form>
      <section className="panel workflow-records">
        <div className="workflow-card-header">
          <h2>People in your workspace</h2>
          <span className="workflow-count">{rows.length} shown</span>
        </div>
        <DataTable
          rows={rows}
          columns={[
            ["displayName", "Name"],
            ["phone", "Phone"],
            ["role", "Role"],
            ["status", "Current status"],
          ]}
          action={(row) => (
            <div className="workflow-row-actions">
              <select
                value={drafts[row.id] || row.status}
                aria-label={`Access status for ${row.displayName}`}
                disabled={busy}
                onChange={(event) =>
                  setDrafts({ ...drafts, [row.id]: event.target.value })
                }
              >
                {statuses.map((status) => (
                  <option value={status.value} key={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
              <button
                className="button button-outline"
                disabled={
                  busy || !drafts[row.id] || drafts[row.id] === row.status
                }
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  setMessage("");
                  try {
                    const updated = await api<Person>(
                      `/users/${row.id}/status`,
                      {
                        method: "PATCH",
                        body: JSON.stringify({ status: drafts[row.id] }),
                      },
                    );
                    setRows((previous) =>
                      previous.map((person) =>
                        person.id === row.id ? updated : person,
                      ),
                    );
                    setMessage(`Access status updated for ${row.displayName}.`);
                  } catch (failure) {
                    setError((failure as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save
              </button>
            </div>
          )}
        />
      </section>
    </FormLayout>
  );
}
