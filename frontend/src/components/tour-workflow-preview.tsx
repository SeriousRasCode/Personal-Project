import type { Session } from "../lib/api";
import { TourDemoContext, demoAreaId } from "../lib/tour-demo";
import type { TourPreviewKind } from "../lib/tour-workflows";
import { WorkOrderForm } from "./work-order-form";
import { RotationEditor } from "./rotation-editor";
import { MonitoringPointForm } from "./monitoring-point-form";
import { FormField } from "./forms";
const noop = () => {};
export function TourWorkflowPreview({
  kind,
  session,
}: {
  kind: TourPreviewKind;
  session: Session | null;
}) {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return (
    <TourDemoContext.Provider value={true}>
      <section
        className="tour-workflow-preview panel"
        aria-label="Read-only workflow demonstration"
        onSubmitCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <p className="eyebrow">TOUR DEMONSTRATION · NO CHANGES ARE SAVED</p>
        {(kind === "order-create" || kind === "incident-order") && (
          <WorkOrderForm
            suggestedTitle="Repair leak beside the market"
            onSaved={noop}
            onCancel={noop}
          />
        )}
        {kind === "rotation-edit" && (
          <RotationEditor
            rotation={{
              id: demoAreaId,
              kebeleId: demoAreaId,
              kebele: { name: "Example service area", code: "DEMO" },
              name: "Example midnight rotation",
              startsOn: tomorrow,
              endsOn: tomorrow,
              status: "DRAFT",
              notes: "Example only — this plan is not saved.",
              updatedAt: new Date().toISOString(),
              windows: [
                {
                  id: demoAreaId,
                  standpipeId: null,
                  startsAt: tomorrow + "T00:00:00+03:00",
                  endsAt: tomorrow + "T03:00:00+03:00",
                  status: "SCHEDULED",
                  updatedAt: new Date().toISOString(),
                },
              ],
            }}
            onSaved={noop}
            onCancel={noop}
          />
        )}
        {kind === "monitoring-point" && (
          <MonitoringPointForm onCreated={noop} />
        )}
        {kind === "order-progress" && (
          <form className="workflow-form">
            <h2>Update repair progress</h2>
            <p>
              {session?.user.role === "FIELD_TECHNICIAN" ||
              session?.user.role === "STANDPIPE_OPERATOR"
                ? "Your own assigned order"
                : "Selected maintenance order"}{" "}
              · Example activity history remains available beside the live form.
            </p>
            <FormField
              label="Next status"
              hint="Available options depend on the current state and your assignment."
            >
              <select name="status" defaultValue="IN_PROGRESS">
                <option value="ACKNOWLEDGED">Acknowledged</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="ON_HOLD">On hold</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </FormField>
            <FormField
              label="Progress / resolution note"
              hint="Explain the repair and verification before completing an order."
            >
              <textarea
                name="note"
                placeholder="Replaced damaged joint and checked the water flow."
              />
            </FormField>
            <button type="button" className="button button-primary" disabled>
              Save progress · demonstration only
            </button>
          </form>
        )}
        {kind === "incident-triage" && (
          <form className="workflow-form">
            <h2>Incident evidence and triage</h2>
            <p>
              Example: three nearby reports, visible rupture, location and
              confidence reviewed. Inspect the real report photos in the live
              incident panel.
            </p>
            <FormField label="Triage decision">
              <select name="status">
                <option>TRIAGED</option>
                <option>REJECTED</option>
              </select>
            </FormField>
            <FormField label="Decision note">
              <textarea
                name="note"
                placeholder="Reports corroborate a pipe burst beside the market."
              />
            </FormField>
            <button type="button" className="button button-primary" disabled>
              Save triage decision · demonstration only
            </button>
          </form>
        )}
      </section>
    </TourDemoContext.Provider>
  );
}
