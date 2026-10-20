export const STAFF_ROLES = new Set([
  "ADMIN",
  "DISPATCHER",
  "FIELD_TECHNICIAN",
  "STANDPIPE_OPERATOR",
]);

export const NAVIGATION = [
  { id: "overview", label: "Overview", access: "public" },
  { id: "water-points", label: "Water points", access: "public" },
  { id: "leaks", label: "Leak activity", access: "public" },
  { id: "reports", label: "Make a report", access: "user" },
  { id: "operations", label: "Operations", access: "staff" },
  { id: "telemetry", label: "Telemetry", access: "staff" },
  { id: "maintenance", label: "Maintenance", access: "staff" },
  { id: "schedules", label: "Schedules", access: "staff" },
  { id: "users", label: "Users", access: "admin" },
  { id: "inbox", label: "Inbox", access: "user" },
  { id: "account", label: "Account", access: "user" },
];

export const RESOURCE_CONFIG = {
  telemetry: {
    title: "Telemetry sensors",
    endpoint: "/telemetry/sensors?limit=100&page=1",
    columns: [["name", "Sensor"], ["type", "Type"], ["status", "Status"]],
  },
  maintenance: {
    title: "Valves",
    endpoint: "/maintenance/valves?limit=100&page=1",
    columns: [["code", "Code"], ["state", "State"], ["updatedAt", "Updated"]],
  },
  schedules: {
    title: "Schedules",
    endpoint: "/schedules?limit=100&page=1",
    columns: [["name", "Name"], ["status", "Status"], ["startDate", "Start"]],
  },
  users: {
    title: "Users",
    endpoint: "/users?limit=100&page=1",
    columns: [["displayName", "Name"], ["phone", "Phone"], ["role", "Role"], ["status", "Status"]],
  },
};

export function canAccess(item, session) {
  if (item.access === "public") return true;
  if (!session) return false;
  if (item.access === "user") return true;
  if (item.access === "staff") return STAFF_ROLES.has(session.user?.role);
  return session.user?.role === "ADMIN";
}
