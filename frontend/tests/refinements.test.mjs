import test from "node:test";
import assert from "node:assert/strict";
import { scrollMetrics } from "../src/lib/scroll.ts";
import { workflowGuides } from "../src/lib/tour-workflows.ts";
const session = (role) => ({ user: { id: "test", role } });
test("water scroll metrics clamp boundaries and handle short pages", () => {
  assert.equal(scrollMetrics(0, 800, 800, 400).range, 0);
  assert.equal(scrollMetrics(-1, 800, 2000, 400).progress, 0);
  assert.equal(scrollMetrics(3000, 800, 2000, 400).progress, 1);
  const middle = scrollMetrics(600, 800, 2000, 400);
  assert.equal(middle.progress, 0.5);
  assert.equal(middle.offset, (400 - middle.thumb) / 2);
});
test("latest forms and map controls are included in role-appropriate tours", () => {
  for (const route of ["operations", "schedules", "leaks", "telemetry"]) {
    assert.deepEqual(workflowGuides(route, session("CITIZEN")), []);
  }
  for (const role of ["ADMIN", "DISPATCHER"]) {
    assert.ok(
      workflowGuides("operations", session(role)).some(
        (step) => step.preview === "order-create",
      ),
    );
    assert.ok(
      workflowGuides("schedules", session(role)).some(
        (step) => step.preview === "rotation-edit",
      ),
    );
    assert.ok(
      workflowGuides("leaks", session(role)).some(
        (step) => step.preview === "incident-order",
      ),
    );
    assert.ok(
      workflowGuides("telemetry", session(role)).some(
        (step) => step.preview === "monitoring-point",
      ),
    );
  }
  for (const role of ["FIELD_TECHNICIAN", "STANDPIPE_OPERATOR"]) {
    assert.ok(
      !workflowGuides("operations", session(role)).some(
        (step) => step.preview === "order-create",
      ),
    );
    assert.ok(
      workflowGuides("operations", session(role)).some(
        (step) => step.preview === "order-progress",
      ),
    );
    assert.equal(workflowGuides("schedules", session(role)).length, 0);
  }
  assert.ok(
    workflowGuides("telemetry", session("FIELD_TECHNICIAN")).some((step) =>
      step.target?.includes("network-map"),
    ),
  );
});
