import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccessPage,
  canPerform,
  canReadAttachment,
  ownsAttachment,
  pagePermissions,
} from "../src/lib/permissions.ts";

const session = (role, status = "ACTIVE") => ({
  user: { id: "account-1", role, status },
});
const publicPages = ["overview", "water-points", "schedules"];
const accountPages = [
  ...publicPages,
  "reports",
  "inbox",
  "preferences",
  "storage",
];
const fieldPages = [
  ...accountPages,
  "operations",
  "telemetry",
  "maintenance",
  "geography",
  "leaks",
];
const expected = {
  ADMIN: Object.keys(pagePermissions),
  DISPATCHER: [...fieldPages, "ussd"],
  FIELD_TECHNICIAN: fieldPages,
  STANDPIPE_OPERATOR: [...accountPages, "operations"],
  CITIZEN: accountPages,
};

for (const [role, pages] of Object.entries(expected)) {
  test(`${role}: allowed pages and forbidden direct routes`, () => {
    for (const page of Object.keys(pagePermissions)) {
      assert.equal(
        canAccessPage(page, session(role)),
        pages.includes(page),
        `${role}: ${page}`,
      );
    }
  });
  test(`${role}: mutation permissions`, () => {
    for (const action of ["work-order.manage", "leak.triage", "sensor.manage"])
      assert.equal(
        canPerform(action, session(role)),
        ["ADMIN", "DISPATCHER"].includes(role),
      );
    assert.equal(canPerform("area.manage", session(role)), role === "ADMIN");
    assert.equal(
      canPerform("schedule.manage", session(role)),
      ["ADMIN", "DISPATCHER"].includes(role),
    );
    for (const action of ["sensor.reading", "valve.operate"]) {
      assert.equal(
        canPerform(action, session(role)),
        ["ADMIN", "DISPATCHER", "FIELD_TECHNICIAN"].includes(role),
      );
    }
    for (const action of ["users.manage", "outbox.manage"])
      assert.equal(canPerform(action, session(role)), role === "ADMIN");
  });
  test(`${role}: attachment ownership is required for deletion`, () => {
    const own = "leaks/account-1/2026/10/photo.jpg";
    const other = "leaks/account-2/2026/10/photo.jpg";
    assert.equal(ownsAttachment(own, session(role)), true);
    assert.equal(ownsAttachment(other, session(role)), false);
    assert.equal(canReadAttachment(own, session(role)), true);
    assert.equal(
      canReadAttachment(other, session(role)),
      ["ADMIN", "DISPATCHER", "FIELD_TECHNICIAN"].includes(role),
    );
    assert.equal(canReadAttachment("", session(role)), false);
    assert.equal(
      ownsAttachment("leaks/account-1/2026/10/../photo.jpg", session(role)),
      false,
    );
  });
}
test("guest, unknown and inactive sessions fail closed for protected features", () => {
  for (const page of Object.keys(pagePermissions)) {
    for (const user of [
      null,
      session("UNKNOWN"),
      session("ADMIN", "SUSPENDED"),
      session("ADMIN", "DEACTIVATED"),
      session("CITIZEN", "PENDING_VERIFICATION"),
    ]) {
      assert.equal(canAccessPage(page, user), publicPages.includes(page));
    }
  }
  assert.equal(canAccessPage("unknown", session("ADMIN")), false);
  assert.equal(canPerform("unknown", session("ADMIN")), false);
  assert.equal(
    ownsAttachment("leaks/account-1/2026/10/photo.jpg", null),
    false,
  );
});
