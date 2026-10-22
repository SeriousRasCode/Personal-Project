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
      "Choose the water point by name. If a search box is shown, filter the options by name or code. The record ID is handled automatically.",
    example: "Central market water point · JIM-01",
  },
  sensorId: {
    description:
      "Choose the sensor by name to connect the reading to the correct device. You do not need to enter its ID.",
    example: "Central market pressure sensor",
  },
  regionId: {
    description:
      "Identify the parent region for this service area using its actual record ID.",
    example: "00000000-0000-4000-8000-000000000003",
  },
  kebeleId: {
    description:
      "Choose the kebele or service area by its name. The schedule will be associated with that selected record automatically.",
    example: "Hermata · JIM-04",
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
  const additions: Record<string, FieldHelp> = {
    title: {
      description:
        "Use a clear repair title so the field team can recognize the task in the work queue.",
      example: "Repair leak beside the market",
    },
    assignedToId: {
      description:
        "Assign this repair to an active technician, operator or dispatcher. Leaving it unassigned keeps it in the open queue.",
      example: "Example field technician",
    },
    priority: {
      description:
        "Choose urgency based on water loss, disruption and safety. Priority helps dispatchers order the repair queue.",
      example: "HIGH",
    },
    scheduledFor: {
      description:
        "Choose the planned field visit time in your device time zone. This does not change the water rotation window.",
      example: "2026-10-23 09:00",
    },
    "progress / resolution note": {
      description:
        "Record what was done and how the repair was checked. A resolution note is required before marking work completed.",
      example: "Replaced the damaged joint and verified normal water flow.",
    },
    "decision note": {
      description:
        "Explain the evidence behind your triage decision so the next person understands why this incident was accepted or rejected.",
      example: "Three nearby reports confirm a visible pipe burst.",
    },
    "find an observation": {
      description:
        "Search the names and condition labels. Results and map markers are filtered together; clear the search to restore them.",
      example: "Ginjo",
    },
    "observation freshness": {
      description:
        "Choose recent observations to exclude stale or unavailable readings. Gray markers never imply healthy pressure.",
      example: "Recent observations only",
    },
    "observation layer": {
      description:
        "Measured pressure uses bar. Crowd consensus estimates full flow, trickle or dry and cannot be interpreted as measured pressure.",
      example: "Crowdsourced flow consensus",
    },
    alertArea: {
      description:
        "Choose your kebele for water-opening and closing alerts and your USSD area. The live Save action updates this setting; this guide does not.",
      example: "Example service area",
    },
  };
  const suffix = field.name.split("-").at(-1);
  const windowHelp: Record<string, FieldHelp> = {
    start: {
      description:
        "Set when this service window opens. A midnight window can close on the following day; keep it inside the rotation date range.",
      example: "2026-10-23 00:00",
    },
    end: {
      description:
        "Set a closing time after the opening time. Overlapping windows are checked when the draft is saved.",
      example: "2026-10-23 03:00",
    },
    min: {
      description:
        "Optional lower pressure target in bar for this service window. This is a planning target, not a measured reading.",
      example: "1.5",
    },
    max: {
      description:
        "Optional upper pressure target in bar. It must not be below the minimum pressure target.",
      example: "3.0",
    },
    point: {
      description:
        "Choose a specific standpipe or leave blank for service across the whole kebele.",
      example: "Example market water point",
    },
  };
  const known =
    additions[label.toLowerCase()] ||
    additions[field.name] ||
    (suffix ? windowHelp[suffix] : undefined) ||
    helpers[label.toLowerCase()] ||
    helpers[field.name];
  if (known)
    return field instanceof HTMLSelectElement
      ? {
          ...known,
          example:
            [...field.options].find((option) => option.value)?.text ||
            known.example,
        }
      : known;
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
  leaks:
    "Filter clustered incidents by severity and status. Select an incident to inspect its location and report evidence. Dispatchers can record triage decisions and create linked maintenance work orders; field technicians have read-only investigation access.",
  overview:
    "Your starting point: inspect the network summary, then use a quick action to find water points or share an observation.",
  "water-points":
    "Browse public water points. The directory shows the names and identifiers that help you find the right water point.",
  reports:
    "Share a water-flow observation, a queue estimate, or a suspected leak. We will walk through each report type and its fields.",
  operations:
    "Filter the repair queue and select an order to inspect its history. Dispatchers create and assign repairs; technicians and operators update their own assigned work. Completing a repair requires a resolution note.",
  telemetry:
    "Inspect the geographic pressure layer or choose an area for crowdsourced flow and queue consensus. Select a location for pressure history. Gray observations are stale or unavailable. Measured bar values and inferred flow are separate layers. You can also record a manual reading below.",
  maintenance:
    "Review valve positions. Opening or closing a valve is a real operational action; the tour never triggers these buttons.",
  schedules:
    "Filter the rotation agenda by service date. Select a rotation to inspect each window. Dispatchers create and edit multi-window drafts, publish and activate plans, and record operations during valid windows. Active plans are reconciled automatically by the schedule clock.",
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
