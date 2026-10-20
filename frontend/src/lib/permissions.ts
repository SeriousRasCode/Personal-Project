import type { Session } from "./api";

export const roles = [
  "ADMIN",
  "DISPATCHER",
  "FIELD_TECHNICIAN",
  "STANDPIPE_OPERATOR",
  "CITIZEN",
] as const;
const staff = ["ADMIN", "DISPATCHER", "FIELD_TECHNICIAN", "STANDPIPE_OPERATOR"];
const fieldTeam = ["ADMIN", "DISPATCHER", "FIELD_TECHNICIAN"];
const managers = ["ADMIN", "DISPATCHER"];
type Rule = "public" | "authenticated" | readonly string[];

// Match controller guards and service-level rules; the API remains authoritative.
export const pagePermissions: Record<string, Rule> = {
  overview: "public",
  "water-points": "public",
  schedules: "public",
  reports: "authenticated",
  inbox: "authenticated",
  preferences: "authenticated",
  storage: "authenticated",
  operations: staff,
  telemetry: fieldTeam,
  maintenance: fieldTeam,
  geography: fieldTeam,
  ussd: managers,
  users: ["ADMIN"],
  audit: ["ADMIN"],
  outbox: ["ADMIN"],
};
export const actionPermissions: Record<string, Rule> = {
  "area.manage": ["ADMIN"],
  "schedule.manage": managers,
  "sensor.reading": fieldTeam,
  "valve.operate": fieldTeam,
  "users.manage": ["ADMIN"],
  "outbox.manage": ["ADMIN"],
};
function allowed(rule: Rule | undefined, session: Session | null) {
  if (rule === "public") return true;
  if (!session || !roles.includes(session.user.role as (typeof roles)[number]))
    return false;
  const status = (session.user as { status?: string }).status;
  if (status && status !== "ACTIVE") return false;
  return (
    rule === "authenticated" ||
    Boolean(rule && rule.includes(session.user.role))
  );
}
export const canAccessPage = (page: string, session: Session | null) =>
  allowed(pagePermissions[page], session);
export const canPerform = (action: string, session: Session | null) =>
  allowed(actionPermissions[action], session);

export function ownsAttachment(key: string, session: Session | null) {
  if (!session || !canAccessPage("storage", session)) return false;
  const segments = key.trim().split("/");
  const owner =
    session.user.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "unknown";
  return (
    segments.length === 5 &&
    segments[0] === "leaks" &&
    segments[1] === owner &&
    /^[\w-]+\.[A-Za-z0-9]+$/.test(segments[4])
  );
}
export function canReadAttachment(key: string, session: Session | null) {
  return (
    Boolean(key.trim()) &&
    canAccessPage("storage", session) &&
    (fieldTeam.includes(session!.user.role) || ownsAttachment(key, session))
  );
}
