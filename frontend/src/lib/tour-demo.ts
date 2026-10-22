import { createContext } from "react";
export const TourDemoContext = createContext(false);
export const demoAreaId = "00000000-0000-4000-8000-000000000001";
export const demoStaffId = "00000000-0000-4000-8000-000000000002";
export function demoChoices(endpoint: string): {
  id: string;
  name?: string;
  code?: string;
  displayName?: string;
  role?: string;
}[] {
  if (endpoint.includes("assignees"))
    return [
      {
        id: demoStaffId,
        displayName: "Example field technician",
        role: "FIELD_TECHNICIAN",
      },
    ];
  return [
    {
      id: demoAreaId,
      name: endpoint.includes("kebeles")
        ? "Example service area"
        : endpoint.includes("sensors")
          ? "Example monitoring point"
          : "Example market water point",
      code: "DEMO",
    },
  ];
}
