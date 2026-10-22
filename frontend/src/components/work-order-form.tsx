import { useState, useContext } from "react";
import { TourDemoContext, demoChoices } from "../lib/tour-demo";
import { api } from "../lib/api";
import type { WorkOrder } from "../lib/dispatch";
import { localDateTime } from "../lib/dispatch";
import { useCollection } from "../lib/use-collection";
import { FormField, FormFeedback } from "./forms";
export function AssigneeField({
  value = "",
  disabled = false,
}: {
  value?: string;
  disabled?: boolean;
}) {
  const demo = useContext(TourDemoContext);
  const data = useCollection<{ id: string; displayName: string; role: string }>(
    "/work-orders/assignees",
    0,
    !demo,
  );
  return (
    <FormField
      label="Assigned staff"
      hint={
        data.error ||
        "Only active technicians, operators and dispatchers are listed."
      }
    >
      <select
        name="assignedToId"
        defaultValue={value}
        disabled={disabled || data.loading}
      >
        <option value="">Unassigned</option>
        {(demo ? demoChoices("/assignees") : data.items).map((person) => (
          <option key={person.id} value={person.id}>
            {person.displayName} ·{" "}
            {(person.role || "FIELD_TECHNICIAN")
              .toLowerCase()
              .replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </FormField>
  );
}
export function WorkOrderForm({
  order,
  clusterId,
  suggestedTitle = "",
  onSaved,
  onCancel,
}: {
  order?: WorkOrder;
  clusterId?: string;
  suggestedTitle?: string;
  onSaved: (order: WorkOrder) => void;
  onCancel: () => void;
}) {
  const demo = useContext(TourDemoContext);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="workflow-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (demo) return;
        const data = new FormData(event.currentTarget);
        if (!data.has("assignedToId")) {
          setError("Wait for the staff directory to load before saving.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          const result = await api<WorkOrder>(
            order ? `/work-orders/${order.id}` : "/work-orders",
            {
              method: order ? "PATCH" : "POST",
              body: JSON.stringify({
                title: data.get("title"),
                description: data.get("description"),
                priority: data.get("priority"),
                assignedToId: data.get("assignedToId") || null,
                scheduledFor: data.get("scheduledFor")
                  ? new Date(String(data.get("scheduledFor"))).toISOString()
                  : null,
                ...(order
                  ? { expectedUpdatedAt: order.updatedAt }
                  : { leakClusterId: clusterId || null }),
              }),
            },
          );
          onSaved(result);
        } catch (failure) {
          setError((failure as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{order ? "Edit work order" : "Create maintenance work order"}</h2>
      <FormField label="Title">
        <input
          name="title"
          defaultValue={order?.title || suggestedTitle}
          minLength={5}
          maxLength={180}
          required
          disabled={busy}
        />
      </FormField>
      <FormField label="Repair instructions">
        <textarea
          name="description"
          defaultValue={order?.description}
          minLength={10}
          maxLength={4000}
          required
          disabled={busy}
          placeholder="Describe the issue, access directions, and repair needed."
        />
      </FormField>
      <div className="workflow-columns">
        <FormField label="Priority">
          <select
            name="priority"
            defaultValue={order?.priority || "NORMAL"}
            disabled={busy}
          >
            {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Scheduled visit" optional>
          <input
            name="scheduledFor"
            type="datetime-local"
            defaultValue={
              order?.scheduledFor ? localDateTime(order.scheduledFor) : ""
            }
            disabled={busy}
          />
        </FormField>
      </div>
      <AssigneeField value={order?.assignedToId || ""} disabled={busy} />
      <FormFeedback error={error} />
      <div className="dispatch-toolbar">
        <button className="button button-primary" disabled={busy}>
          {busy ? "Saving…" : "Save work order"}
        </button>
        <button
          type="button"
          className="button button-outline"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
