export type RotationWindow = {
  id: string;
  standpipeId: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  updatedAt: string;
  minimumPressureBar?: number | null;
  maximumPressureBar?: number | null;
  notes?: string | null;
  standpipe?: { name: string } | null;
};
export type Rotation = {
  id: string;
  kebeleId: string;
  kebele: { name: string; code: string };
  name: string;
  startsOn: string;
  endsOn: string;
  status: string;
  notes: string | null;
  updatedAt: string;
  windows: RotationWindow[];
};
export const scheduleActions: Record<string, string[]> = {
  DRAFT: ["publish", "cancel"],
  PUBLISHED: ["activate", "cancel"],
  ACTIVE: ["complete", "cancel"],
};
export function windowAction(
  rotation: Rotation,
  window: RotationWindow,
  now = Date.now(),
) {
  if (
    !["PUBLISHED", "ACTIVE"].includes(rotation.status) ||
    now < Date.parse(window.startsAt) ||
    now > Date.parse(window.endsAt)
  )
    return null;
  return window.status === "SCHEDULED"
    ? "open"
    : window.status === "OPENED"
      ? "close"
      : null;
}
