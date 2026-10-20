export type Page<T> = {
  items: T[];
  meta?: { page: number; totalPages: number; total: number };
};
export type WorkOrder = {
  id: string;
  code: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  assignedToId: string | null;
  assignee: { id: string; displayName: string } | null;
  leakClusterId: string | null;
  scheduledFor: string | null;
  updatedAt: string;
  resolutionNote?: string;
};
export type Cluster = {
  id: string;
  code: string;
  kebeleCode: string;
  severity: string;
  status: string;
  confidence: number;
  reportCount: number;
  centroidLatitude: number | null;
  centroidLongitude: number | null;
  updatedAt: string;
};
export type LeakReport = {
  id: string;
  description: string;
  severity: string;
  photoObjectKey: string | null;
  source: string;
  observedAt: string;
  location: { latitude: number; longitude: number };
};
export const leakTransitions: Record<string, string[]> = {
  OPEN: ["TRIAGED", "REJECTED"],
  TRIAGED: ["INVESTIGATING", "RESOLVED"],
  INVESTIGATING: ["RESOLVED"],
};
export const orderTransitions: Record<string, string[]> = {
  OPEN: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["ACKNOWLEDGED", "ON_HOLD", "CANCELLED"],
  ACKNOWLEDGED: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "ON_HOLD", "CANCELLED"],
  ON_HOLD: ["IN_PROGRESS", "CANCELLED"],
};
export function orderActions(order: WorkOrder, role: string, userId: string) {
  const options = orderTransitions[order.status] || [];
  if (["ADMIN", "DISPATCHER"].includes(role)) return options;
  return ["FIELD_TECHNICIAN", "STANDPIPE_OPERATOR"].includes(role) &&
    order.assignedToId === userId
    ? options.filter((value) =>
        ["ACKNOWLEDGED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"].includes(value),
      )
    : [];
}
export const human = (value: string) =>
  value.toLowerCase().replaceAll("_", " ");
export const when = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "Not set";
export function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
