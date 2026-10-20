import { useEffect, useState } from "react";
import { api, getSession } from "../lib/api";
import { canPerform } from "../lib/permissions";
import {
  FormActions,
  FormFeedback,
  FormField,
  FormLayout,
  FormSection,
  RecordPicker,
} from "../components/forms";
import { DataTable } from "../components/ui";

type Schedule = {
  id: string;
  name: string;
  status: string;
  startsOn: string;
  endsOn: string;
  updatedAt: string;
};
const lifecycle: Record<string, { label: string; action: string }[]> = {
  DRAFT: [
    { label: "Publish", action: "publish" },
    { label: "Cancel", action: "cancel" },
  ],
  PUBLISHED: [
    { label: "Activate", action: "activate" },
    { label: "Cancel", action: "cancel" },
  ],
  ACTIVE: [
    { label: "Complete", action: "complete" },
    { label: "Cancel", action: "cancel" },
  ],
};
export function Schedules() {
  const [rows, setRows] = useState<Schedule[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [starts, setStarts] = useState("");
  const [area, setArea] = useState("");
  const canManage = canPerform("schedule.manage", getSession());
  useEffect(() => {
    api<{ items: Schedule[] }>(
      `${canManage ? "/schedules/staff" : "/schedules"}?limit=100&page=1`,
    )
      .then((result) => setRows(result.items))
      .catch((failure) => setError(failure.message));
  }, [canManage]);
  return (
    <FormLayout
      eyebrow="OPERATIONS / WATER SCHEDULES"
      title="Plan water service"
      description="Set a clear service period and keep the next action beside the schedule it affects."
      help={
        <>
          <p>
            Choose the kebele by name, then enter a start and end date. New
            schedules are saved as drafts.
          </p>
          <p>
            Drafts need to be published before activation. Only actions
            appropriate to the schedule’s current status are shown.
          </p>
        </>
      }
    >
      {canManage && (
        <form
          className="workflow-form"
          aria-busy={busy}
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            if (!data.get("kebeleId")) {
              setError("Choose a service area first.");
              return;
            }
            if (
              String(data.get("windowEndsAt")) <=
              String(data.get("windowStartsAt"))
            ) {
              setError("The service window must close after it opens.");
              return;
            }
            if (
              String(data.get("windowStartsAt")).slice(0, 10) < starts ||
              String(data.get("windowEndsAt")).slice(0, 10) >
                String(data.get("endsOn"))
            ) {
              setError(
                "Keep the service window within the schedule’s start and end dates.",
              );
              return;
            }
            setBusy(true);
            setError("");
            setMessage("");
            try {
              const created = await api<Schedule>("/schedules", {
                method: "POST",
                body: JSON.stringify({
                  kebeleId: data.get("kebeleId"),
                  name: data.get("name"),
                  startsOn: starts,
                  endsOn: data.get("endsOn"),
                  notes: data.get("notes") || null,
                  windows: [
                    {
                      startsAt: new Date(
                        String(data.get("windowStartsAt")),
                      ).toISOString(),
                      endsAt: new Date(
                        String(data.get("windowEndsAt")),
                      ).toISOString(),
                      standpipeId: data.get("windowStandpipeId") || null,
                    },
                  ],
                }),
              });
              setRows((previous) => [created, ...previous]);
              setMessage(
                "Draft schedule created. Review it below before publishing.",
              );
            } catch (failure) {
              setError((failure as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FormSection number="01" title="Name and service area">
            <FormField
              label="Schedule name"
              hint="A name that explains the plan at a glance."
            >
              <input
                name="name"
                placeholder="e.g. Eastern neighbourhood — morning rotation"
                required
                maxLength={160}
                disabled={busy}
              />
            </FormField>
            <RecordPicker
              endpoint="/kebeles"
              label="Service area"
              name="kebeleId"
              disabled={busy}
              onChange={setArea}
            />
          </FormSection>
          <FormSection number="02" title="Choose the service period">
            <div className="workflow-columns">
              <FormField label="Start date">
                <input
                  name="startsOn"
                  type="date"
                  value={starts}
                  onChange={(event) => setStarts(event.target.value)}
                  required
                  disabled={busy}
                />
              </FormField>
              <FormField
                label="End date"
                hint="The end date must not be before the start."
              >
                <input
                  name="endsOn"
                  type="date"
                  min={starts || undefined}
                  required
                  disabled={busy}
                />
              </FormField>
            </div>
            <FormField
              label="Notes"
              hint="Add context for the team who will operate this schedule."
              optional
            >
              <textarea
                name="notes"
                placeholder="e.g. Morning service for the eastern neighbourhood."
                maxLength={4000}
                disabled={busy}
              />
            </FormField>
          </FormSection>
          <FormSection
            number="03"
            title="Set the service window"
            description="Choose when water should be available within this date range. Times use your device’s local time zone."
          >
            <div className="workflow-columns">
              <FormField label="Window opens">
                <input
                  name="windowStartsAt"
                  type="datetime-local"
                  min={starts ? `${starts}T00:00` : undefined}
                  required
                  disabled={busy}
                />
              </FormField>
              <FormField
                label="Window closes"
                hint="Choose a time after the opening time."
              >
                <input
                  name="windowEndsAt"
                  type="datetime-local"
                  min={starts ? `${starts}T00:00` : undefined}
                  required
                  disabled={busy}
                />
              </FormField>
            </div>
            {area && (
              <RecordPicker
                key={area}
                endpoint={`/public/standpipes?kebeleId=${encodeURIComponent(area)}`}
                name="windowStandpipeId"
                label="Specific water point"
                hint="Leave blank for an area-wide service window."
                required={false}
                disabled={busy}
              />
            )}
          </FormSection>
          <FormFeedback error={error} message={message} />
          <FormActions busy={busy} label="Save draft schedule" />
        </form>
      )}
      <section className="panel workflow-records">
        <div className="workflow-card-header">
          <h2>Service schedules</h2>
          <span className="workflow-count">{rows.length} shown</span>
        </div>
        {!canManage && <FormFeedback error={error} />}
        <DataTable
          rows={rows}
          columns={[
            ["name", "Schedule"],
            ["status", "Status"],
            ["startsOn", "Starts"],
            ["endsOn", "Ends"],
          ]}
          action={
            canManage
              ? (row) => (
                  <div className="workflow-row-actions">
                    {(lifecycle[row.status] || []).map((action) => (
                      <button
                        className="button button-outline"
                        key={action.action}
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError("");
                          setMessage("");
                          try {
                            const updated = await api<Schedule>(
                              `/schedules/${row.id}/${action.action}`,
                              {
                                method: "POST",
                                body: JSON.stringify({
                                  updatedAt: row.updatedAt,
                                }),
                              },
                            );
                            setRows((previous) =>
                              previous.map((item) =>
                                item.id === row.id ? updated : item,
                              ),
                            );
                            setMessage("Schedule updated.");
                          } catch (failure) {
                            setError((failure as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )
              : undefined
          }
        />
        <p className="workflow-section-description">
          {canManage
            ? "Drafts, published plans and active schedules are shown here."
            : "Published and active schedules are shown here."}
        </p>
      </section>
    </FormLayout>
  );
}
