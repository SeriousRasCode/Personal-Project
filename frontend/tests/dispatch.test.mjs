import test from "node:test";
import assert from "node:assert/strict";
import { orderActions } from "../src/lib/dispatch.ts";
import { windowAction } from "../src/lib/rotations.ts";
import {
  projectPoints,
  isStale,
  pressureColor,
} from "../src/lib/monitoring.ts";
test("field staff only see valid actions for assigned work", () => {
  const order = { status: "ASSIGNED", assignedToId: "tech" };
  assert.deepEqual(orderActions(order, "FIELD_TECHNICIAN", "tech"), [
    "ACKNOWLEDGED",
    "ON_HOLD",
  ]);
  assert.deepEqual(orderActions(order, "FIELD_TECHNICIAN", "other"), []);
  assert.deepEqual(orderActions(order, "CITIZEN", "tech"), []);
  assert.ok(orderActions(order, "DISPATCHER", "manager").includes("CANCELLED"));
});
test("window controls require active/published plans and current time bounds", () => {
  const window = {
    status: "SCHEDULED",
    startsAt: "2026-10-20T00:00:00Z",
    endsAt: "2026-10-20T03:00:00Z",
  };
  const now = Date.parse("2026-10-20T01:00:00Z");
  assert.equal(windowAction({ status: "ACTIVE" }, window, now), "open");
  assert.equal(
    windowAction({ status: "ACTIVE" }, { ...window, status: "OPENED" }, now),
    "close",
  );
  assert.equal(windowAction({ status: "DRAFT" }, window, now), null);
  assert.equal(
    windowAction({ status: "ACTIVE" }, window, now + 4 * 3600000),
    null,
  );
});
test("map excludes missing coordinates and handles one point without invalid coordinates", () => {
  const points = projectPoints([
    { id: "one", latitude: 7.67, longitude: 36.83 },
    { id: "missing", latitude: null, longitude: null },
  ]);
  assert.equal(points.length, 1);
  assert.equal(points[0].x, 380);
  assert.equal(points[0].y, 210);
});
test("stale and unknown pressure is never rendered as healthy measured pressure", () => {
  assert.equal(isStale(null), true);
  assert.equal(isStale("invalid"), true);
  assert.equal(pressureColor(null), "#7c8d88");
  assert.notEqual(pressureColor(0), pressureColor(2));
});
