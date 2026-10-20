import { useEffect, useRef, useState } from "react";
import { navigation, roleLabels } from "./navigation";
import type { Session } from "../lib/api";

const explanations: Record<string, string> = {
  overview:
    "Start with the network overview. See community water points, active leak areas and shortcuts to your next task.",
  "water-points":
    "Find public water points in your community. Browse the directory before planning a water collection trip.",
  reports:
    "Share what you observe: water flow, queue waits or a suspected leak. Your updates help neighbours and the response team.",
  operations:
    "Review work orders. Dispatchers coordinate the response; technicians and operators see the work made available to their account.",
  telemetry:
    "Review registered sensors and record manual pressure measurements to support network monitoring.",
  maintenance:
    "Review valves and request open or close actions. Check the valve carefully before changing its position.",
  schedules:
    "Review water schedules and the lifecycle controls available to your role. Changes affect the service plan for your community.",
  geography:
    "Manage the service areas that organise your water network. Administrative changes should match your local records.",
  users:
    "Review people and account access. Only administrators can use this section.",
  ussd: "Inspect USSD sessions to understand activity from people who use the phone-based service.",
  storage:
    "Access attachment administration using an object key. Review the object carefully before deleting it.",
  audit:
    "Inspect the activity log to understand which administrative actions have been recorded.",
  outbox:
    "Inspect event delivery. Administrative controls can run pending delivery or release stale processing locks.",
  inbox:
    "Read notifications connected to your account and mark updates as read once you have reviewed them.",
  preferences:
    "Choose how the available notification channels are used for your account.",
};

export function GuidedTour({
  session,
  onMenuChange,
}: {
  session: Session | null;
  onMenuChange: (open: boolean) => void;
}) {
  const identity = session
    ? `${session.user.id}:${session.user.role}`
    : "guest";
  const storageKey = `hydrojimma.tour.v1:${identity}`;
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const role = session?.user.role;
  const destinations = navigation.filter(
    (item) =>
      (!item.authenticated || session) &&
      (!item.roles || (role && item.roles.includes(role))),
  );
  const total = destinations.length + 2;
  const destination =
    step !== null && step > 0 && step < total - 1
      ? destinations[step - 1]
      : null;

  useEffect(() => {
    try {
      if (!localStorage.getItem(storageKey)) setStep(0);
    } catch {
      /* Replay remains available if storage is blocked. */
    }
  }, [storageKey]);

  useEffect(() => {
    if (step === null) return;
    previousFocus.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previousFocus.current?.focus();
    };
  }, [step === null]);

  useEffect(() => {
    if (step === null) {
      onMenuChange(false);
      return;
    }
    const mobile = window.matchMedia("(max-width: 680px)").matches;
    onMenuChange(Boolean(destination && mobile));
    const update = () => {
      const target = destination
        ? document.querySelector<HTMLElement>(`[data-tour="${destination.id}"]`)
        : step === total - 1
          ? document.querySelector<HTMLElement>(".theme-toggle")
          : null;
      if (destination)
        target?.scrollIntoView({ block: "nearest", behavior: "instant" });
      setBox(target?.getBoundingClientRect() || null);
    };
    const frame = requestAnimationFrame(update);
    // Account for the mobile drawer opening before positioning its spotlight.
    const timer = window.setTimeout(update, 250);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener("resize", update);
    };
  }, [step, destination?.id]);

  function finish() {
    try {
      localStorage.setItem(storageKey, "done");
    } catch {
      /* This visit still completes. */
    }
    setStep(null);
    setBox(null);
    onMenuChange(false);
  }
  const heading =
    step === 0
      ? `Welcome to ${roleLabels[role || "CITIZEN"] || "HydroJimma"}.`
      : destination
        ? destination.label
        : "Make this space your own.";
  const copy =
    step === 0
      ? "Let’s take a quick look around. This tour explains the tools available to your account. You can skip now and replay it any time from “Take a tour”."
      : destination
        ? explanations[destination.id]
        : "Use the sun and moon switch to choose your theme. Your choice is remembered on this device. You’re ready to explore—replay this tour whenever you need a reminder.";
  return (
    <>
      <button
        type="button"
        className="tour-launch"
        onClick={() => setStep(0)}
        aria-label="Start guided navigation tour"
      >
        <span aria-hidden="true">✧</span>
        <span>Take a tour</span>
      </button>
      <dialog
        ref={dialog}
        className="tour-dialog"
        onCancel={(event) => {
          event.preventDefault();
          finish();
        }}
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
      >
        {box && (
          <div
            className="tour-spotlight"
            aria-hidden="true"
            style={{
              top: box.top - 4,
              left: box.left - 4,
              width: box.width + 8,
              height: box.height + 8,
            }}
          />
        )}
        <section className={`tour-card ${box ? "tour-card-guiding" : ""}`}>
          <div className="tour-meta">
            <span>YOUR WORKSPACE GUIDE</span>
            <button type="button" onClick={finish} aria-label="Close tour">
              ×
            </button>
          </div>
          <div className="tour-orbit" aria-hidden="true">
            {destination?.icon || "✧"}
          </div>
          <div key={step} className="tour-copy">
            <h2 id="tour-title">{heading}</h2>
            <p id="tour-description">{copy}</p>
          </div>
          <div
            className="tour-progress"
            role="progressbar"
            aria-label="Tour progress"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={(step ?? 0) + 1}
          >
            <span style={{ width: `${(((step ?? 0) + 1) / total) * 100}%` }} />
          </div>
          <div className="tour-count">
            {(step ?? 0) + 1} of {total} ·{" "}
            {destination ? destination.group : "Getting started"}
          </div>
          <div className="tour-actions">
            <button type="button" onClick={finish} className="tour-skip">
              Skip tour
            </button>
            <div>
              {step !== null && step > 0 && (
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setStep(step - 1)}
                >
                  Back
                </button>
              )}
              <button
                type="button"
                className="button button-primary"
                onClick={() =>
                  step === total - 1 ? finish() : setStep((step ?? 0) + 1)
                }
              >
                {step === 0
                  ? "Show me around"
                  : step === total - 1
                    ? "Let’s explore"
                    : "Next"}{" "}
                →
              </button>
            </div>
          </div>
        </section>
      </dialog>
    </>
  );
}
