export type FieldHelp = { description: string; example: string };

const helpers: Record<string, FieldHelp> = {
  phone: {
    description:
      "Use your phone number with its country code. Sign-up verification codes are sent to this number.",
    example: "+251900000104",
  },
  password: {
    description:
      "Enter your account password. For a new account, choose a unique password that meets the password requirements. This example is a demonstration only.",
    example: "Example!Password2026",
  },
  displayName: {
    description:
      "The name displayed on your account and in staff workflows. Use a name your community or team recognises.",
    example: "Abdi Mohammed",
  },
  code: {
    description:
      "Enter the identifier used in your local records. It should distinguish this record from the others.",
    example: "JIM-04",
  },
  "verification code": {
    description:
      "Enter the six-digit code sent to your phone. The animated digits are an example, not a valid verification code.",
    example: "123456",
  },
  standpipeId: {
    description:
      "Identify the water point this observation belongs to. Copy the real ID from your records; the example ID will not refer to a real water point.",
    example: "00000000-0000-4000-8000-000000000001",
  },
  sensorId: {
    description:
      "Connect this pressure reading to the correct sensor. Use an actual registered sensor ID, not the demonstration ID.",
    example: "00000000-0000-4000-8000-000000000002",
  },
  regionId: {
    description:
      "Identify the parent region for this service area using its actual record ID.",
    example: "00000000-0000-4000-8000-000000000003",
  },
  kebeleId: {
    description:
      "Select the service area this schedule belongs to using its actual record ID.",
    example: "00000000-0000-4000-8000-000000000004",
  },
  pressureBar: {
    description:
      "Enter the measured pressure in bar. For example, 2.4 means a pressure reading of 2.4 bar. Use the actual measurement.",
    example: "2.4",
  },
  waitMinutes: {
    description:
      "Estimate the time a person will wait in the queue, in minutes. Enter 15 for a fifteen-minute wait.",
    example: "15",
  },
  queueSize: {
    description:
      "Enter how many people are waiting, if you can count them. Leave an optional value blank when you do not know.",
    example: "8",
  },
  description: {
    description:
      "Describe what you observed and where it happened. Include landmarks that would help the response team find the issue.",
    example: "Water leaking beside the school gate near the main road.",
  },
  latitude: {
    description:
      "The north–south coordinate of the observed issue. Use its actual location; this example points to the Jimma area.",
    example: "7.6731",
  },
  longitude: {
    description:
      "The east–west coordinate of the observed issue. Use its actual location together with latitude.",
    example: "36.8351",
  },
  severity: {
    description:
      "Describe how serious the suspected leak looks. The response team will review your report.",
    example: "MEDIUM",
  },
  status: {
    description:
      "Choose the state you actually observed. In flow reports, FULL_FLOW means normal flow, TRICKLE means weak flow, and DRY means no water.",
    example: "TRICKLE",
  },
  name: {
    description:
      "Give this record a clear name so other people can recognise it in the directory or schedule.",
    example: "Morning water rotation",
  },
  startsOn: {
    description: "Choose the first day of the water rotation schedule.",
    example: "2026-11-01",
  },
  endsOn: {
    description:
      "Choose the final day of the schedule. It must not precede the start date.",
    example: "2026-11-07",
  },
  notes: {
    description:
      "Add useful context for the next person who reviews this record.",
    example: "Morning service for the eastern neighbourhood.",
  },
  note: {
    description:
      "Add relevant context about the observation, without including private information.",
    example: "Flow became weaker after 9 am.",
  },
  "object key": {
    description:
      "Paste the exact attachment key returned by an upload. Downloads require permission; deletion removes the object. The example is not a real attachment.",
    example: "reports/example/photo.jpg",
  },
};

export function describeField(
  field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  label: string,
): FieldHelp {
  if (field.dataset.tourDescription)
    return {
      description: field.dataset.tourDescription,
      example: field.dataset.tourExample || "Example only",
    };
  if (field.autocomplete === "one-time-code")
    return helpers["verification code"];
  const known = helpers[field.name] || helpers[label.toLowerCase()];
  if (known) return known;
  if (field instanceof HTMLSelectElement)
    return {
      description: `Choose the ${label.toLowerCase()} appropriate to this record. Changes to account access or preferences take effect only through the page controls, never from this tour.`,
      example:
        field.options[1]?.text || field.options[0]?.text || "Choose an option",
    };
  if (field instanceof HTMLInputElement && field.type === "checkbox")
    return {
      description: `Switch ${label.toLowerCase()} on or off to control this preference. This tour only shows an example and does not save changes.`,
      example: "Enabled",
    };
  return {
    description: `Enter ${label.toLowerCase()} for this record. Check the value before using the page’s submit action. The animation is a read-only example.`,
    example: field.placeholder || "Example value",
  };
}

export const pageHelp: Record<string, string> = {
  overview:
    "Your starting point: inspect the network summary, then use a quick action to find water points or share an observation.",
  "water-points":
    "Browse public water points. The directory shows the names and identifiers that help you find the right water point.",
  reports:
    "Share a water-flow observation, a queue estimate, or a suspected leak. We will walk through each report type and its fields.",
  operations:
    "Review work orders available to your account. Dispatchers coordinate repairs; technicians and operators review their assigned work.",
  telemetry:
    "Review sensors and enter manual pressure readings. The following steps explain each input in the reading form.",
  maintenance:
    "Review valve positions. Opening or closing a valve is a real operational action; the tour never triggers these buttons.",
  schedules:
    "Review the water rotation schedule and available lifecycle actions. Publishing, activating or cancelling a schedule changes the service plan.",
  geography:
    "Review service areas and the form used to create a record. Use identifiers from your actual local records.",
  users:
    "Review people and account status controls. Changing account status affects access; the tour never changes an account.",
  ussd: "Review sessions from the phone-based service. Use the table to inspect the available session information.",
  storage:
    "Download or delete an attachment by its key. The tour will explain the field but will never download or delete anything.",
  audit:
    "Read recorded administrative activity. This page helps you understand which actions occurred and when.",
  outbox:
    "Inspect event delivery. Dispatch runs pending events; releasing stuck events makes stale locks available for processing. These actions are never performed by the tour.",
  inbox:
    "Read your notifications and mark an update as read after reviewing it. Your account determines which updates you receive.",
  preferences:
    "Choose which available notification channels are enabled for your account.",
  auth: "This is your account form. We will explain its inputs using animated, read-only examples. Your real values are never replaced.",
};
