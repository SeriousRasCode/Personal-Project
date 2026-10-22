import type { Session } from "./api";
import { canPerform, canAccessPage } from "./permissions.ts";
export type TourPreviewKind =
  | "order-create"
  | "order-progress"
  | "rotation-edit"
  | "incident-triage"
  | "incident-order"
  | "monitoring-point";
export function workflowGuides(
  route: string,
  session: Session | null,
): {
  id: string;
  title: string;
  copy: string;
  preview?: TourPreviewKind;
  target?: string;
}[] {
  if (!canAccessPage(route, session)) return [];
  if (route === "operations")
    return [
      ...(canPerform("work-order.manage", session)
        ? [
            {
              id: "order-create",
              title: "Create and assign a repair",
              copy: "This isolated copy uses the same work-order form as the live page. Choose a clear title, repair instructions, priority, visit time and staff member.",
              preview: "order-create" as const,
            },
          ]
        : []),
      {
        id: "order-progress",
        title: "Repair progress and resolution",
        copy: "Select a work order to view its activity history. Only valid next states are offered. Field staff can update their own assignments. Completing a repair requires a resolution note.",
        preview: "order-progress",
      },
    ];
  if (route === "schedules" && canPerform("schedule.manage", session))
    return [
      {
        id: "rotation-edit",
        title: "Plan and edit service windows",
        copy: "This is an isolated copy of the rotation editor. Add multiple windows, choose area-wide or water-point service, and set pressure targets. Save as a draft, publish, then activate the live plan. The clock opens due windows only in active plans.",
        preview: "rotation-edit",
      },
    ];
  if (route === "leaks")
    return canPerform("leak.triage", session)
      ? [
          {
            id: "incident-triage",
            title: "Investigate and triage an incident",
            copy: "Select a cluster to review location, confidence and photo evidence. Record a triage decision before coordinating repairs. This example never updates a real incident.",
            preview: "incident-triage",
          },
          {
            id: "incident-order",
            title: "Link an incident to a repair",
            copy: "Create a work order from the selected incident. The cluster link is carried automatically; you enter the repair instructions and assignment.",
            preview: "incident-order",
          },
        ]
      : [];
  if (route === "telemetry")
    return [
      {
        id: "map-tools",
        title: "Locate and inspect observations",
        copy: "Pan the street map, zoom with + / −, or use Fit observations. Selecting a marker or result reveals history and location links. Search and freshness filters affect both the map and the results. Gray means stale or unavailable, not healthy.",
        target: '[data-tour-target="network-map"]',
      },
      ...(canPerform("sensor.manage", session)
        ? [
            {
              id: "monitoring-point",
              title: "Set up manual monitoring",
              copy: "Use this form to name an observation point at a standpipe. Manual readings do not require IoT hardware. This is a safe example, not a new record.",
              preview: "monitoring-point" as const,
            },
          ]
        : []),
    ];
  return [];
}
