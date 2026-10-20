import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { navigation, roleLabels } from "./navigation";
import { describeField, pageHelp } from "./tour-content";
import type { Session } from "../lib/api";

type Step = {
  id: string;
  kind: "welcome" | "page" | "field" | "actions" | "theme";
  title: string;
  copy: string;
  route?: string;
  variant?: string;
  fieldIndex?: number;
  example?: string;
  inputType?: string;
};
type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
};
type Props = {
  session: Session | null;
  onMenuChange?: (open: boolean) => void;
  accountMode?: string;
};
const fieldSelector =
  "input:not([type=hidden]):not([type=submit]),select,textarea";

export function GuidedTour({ session, onMenuChange, accountMode }: Props) {
  const storageKey = `hydrojimma.tour.v2:${session ? `${session.user.id}:${session.user.role}` : "guest"}`;
  const [steps, setSteps] = useState<Step[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Rect | null>(null);
  const [fieldBox, setFieldBox] = useState<Rect | null>(null);
  const [typed, setTyped] = useState("");
  const [ready, setReady] = useState(false);
  const [cardPosition, setCardPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const chooser = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);
  const origin = useRef("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const discovered = useRef(new Set<string>());
  const active = index === null ? null : steps[index];
  const isOpen = index !== null;

  function begin(scope: "page" | "all" = "page") {
    chooser.current?.close();
    try {
      if (!accountMode) localStorage.setItem(storageKey, "seen");
    } catch {
      /* Storage is optional. */
    }
    const currentRoute = location.hash.slice(1) || "overview";
    const destinations = navigation.filter(
      (item) =>
        (scope === "all" || item.id === currentRoute) &&
        (!item.authenticated || session) &&
        (!item.roles || (session && item.roles.includes(session.user.role))),
    );
    origin.current = location.hash;
    returnFocus.current = launcher.current;
    discovered.current.clear();
    const pages: Step[] = accountMode
      ? [
          {
            id: `auth-${accountMode}`,
            kind: "page",
            route: "auth",
            title:
              accountMode === "register"
                ? "Create your account"
                : accountMode === "verify"
                  ? "Verify your phone"
                  : "Sign in",
            copy: pageHelp.auth,
          },
        ]
      : destinations.flatMap((item) =>
          item.id === "reports"
            ? ["flow", "queue", "leak"].map((variant) => ({
                id: `reports-${variant}`,
                kind: "page" as const,
                route: "reports",
                variant,
                title: `${variant === "flow" ? "Water flow" : variant === "queue" ? "Queue wait" : "Leak"} report`,
                copy: pageHelp.reports,
              }))
            : [
                {
                  id: item.id,
                  kind: "page" as const,
                  route: item.id,
                  title: item.label,
                  copy: pageHelp[item.id],
                },
              ],
        );
    setSteps([
      {
        id: "welcome",
        kind: "welcome",
        title: accountMode
          ? "Let’s explain this form."
          : `Your ${roleLabels[session?.user.role || "CITIZEN"] || "workspace"} guide.`,
        copy:
          scope === "page"
            ? "This guide stays on your current page. We’ll explain its controls and form fields using animated, read-only examples. Skip or stop at any time."
            : "We’ll open the pages available to your role and explain their controls and fields with animated, read-only examples. Skip or stop at any time.",
      },
      ...pages,
      {
        id: "theme",
        kind: "theme",
        title: "You’re ready to explore.",
        copy: "Use the sun and moon switch to choose your theme. Replay this guide whenever you need a refresher. All demonstrations were read-only.",
      },
    ]);
    setIndex(0);
    setBox(null);
    setFieldBox(null);
    setCardPosition(null);
  }

  useEffect(() => {
    if (accountMode) return;
    try {
      if (!localStorage.getItem(storageKey)) chooser.current?.showModal();
    } catch {
      /* Manual replay is still available. */
    }
  }, [storageKey]);

  useEffect(() => {
    if (!isOpen) return;
    const element = dialog.current;
    element?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("tour-running");
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      document.body.classList.remove("tour-running");
      returnFocus.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!active) return;
    setReady(false);
    setBox(null);
    setFieldBox(null);
    setCardPosition(null);
    onMenuChange?.(false);
    if (!accountMode && active.route && location.hash !== `#${active.route}`)
      location.hash = `#${active.route}`;
    let cancelled = false;
    let observer: MutationObserver | undefined;
    let resize: ResizeObserver | undefined;
    let scanTimer = 0;
    const rootSelector = accountMode ? ".account-form-area" : "#main";
    const scan = () => {
      if (cancelled) return;
      const root = document.querySelector<HTMLElement>(rootSelector);
      if (!root) return;
      root.querySelectorAll("details").forEach((details) => {
        details.open = true;
      });
      if (active.variant)
        root
          .querySelector<HTMLButtonElement>(
            `[data-tour-variant="${active.variant}"]`,
          )
          ?.click();
      window.setTimeout(() => {
        if (cancelled) return;
        const fields = [
          ...root.querySelectorAll<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          >(fieldSelector),
        ].filter((field) => field.getClientRects().length);
        if (active.kind === "page" && !discovered.current.has(active.id)) {
          discovered.current.add(active.id);
          const additions: Step[] = fields.map((field, fieldIndex) => {
            const label = (
              field
                .getAttribute("aria-labelledby")
                ?.split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent?.trim())
                .filter(Boolean)
                .join(" ") ||
              field.labels?.[0]?.childNodes[0]?.textContent ||
              field.getAttribute("aria-label") ||
              field.name ||
              `Option ${fieldIndex + 1}`
            ).trim();
            const help = describeField(field, label);
            return {
              id: `${active.id}-field-${fieldIndex}`,
              kind: "field",
              title: label,
              copy: help.description,
              route: active.route,
              variant: active.variant,
              fieldIndex,
              example: help.example,
              inputType:
                field instanceof HTMLInputElement
                  ? field.type
                  : field.tagName.toLowerCase(),
            };
          });
          const buttons = [
            ...root.querySelectorAll<HTMLButtonElement>(
              "form button[type=submit],form button:not([type]),.panel>button",
            ),
          ].filter(
            (button) =>
              button.getClientRects().length && button.textContent?.trim(),
          );
          if (buttons.length)
            additions.push({
              id: `${active.id}-actions`,
              kind: "actions",
              route: active.route,
              variant: active.variant,
              title: "Before you take action",
              copy: `This page offers: ${[...new Set(buttons.map((button) => button.textContent?.trim()))].slice(0, 5).join(", ")}. These are real actions. Review your values before using them; this guide will never activate them.`,
            });
          setSteps((previous) => {
            const position = previous.findIndex(
              (step) => step.id === active.id,
            );
            if (position < 0) return previous;
            const remaining = previous
              .slice(position + 1)
              .filter(
                (step) =>
                  !step.id.startsWith(`${active.id}-field-`) &&
                  step.id !== `${active.id}-actions`,
              );
            return [
              ...previous.slice(0, position + 1),
              ...additions,
              ...remaining,
            ];
          });
        }
        const measure = () => {
          let target: HTMLElement | null = null;
          if (active.kind === "field")
            target =
              fields[active.fieldIndex ?? 0]?.closest<HTMLElement>(
                ".workflow-field",
              ) ||
              fields[active.fieldIndex ?? 0]?.closest("label") ||
              fields[active.fieldIndex ?? 0];
          else if (active.kind === "page" || active.kind === "actions")
            target =
              root.querySelector("form") ||
              root.querySelector(".panel,.page-heading") ||
              root;
          else if (active.kind === "theme")
            target = document.querySelector(".theme-toggle");
          if (!target) {
            setBox(null);
            setReady(true);
            return;
          }
          // Keep the real highlighted content in view; only a demo copy receives example values.
          if (active.kind === "field") {
            target.scrollIntoView({
              block: window.innerWidth < 700 ? "start" : "center",
              behavior: "instant",
            });
            if (window.innerWidth < 700)
              window.scrollBy({ top: -100, behavior: "instant" });
          } else if (active.kind === "page")
            window.scrollTo({ top: 0, behavior: "instant" });
          const rect = target.getBoundingClientRect();
          const top = Math.max(accountMode ? 8 : 85, rect.top - 7);
          const bottom = Math.min(window.innerHeight - 12, rect.bottom + 7);
          const left = Math.max(8, rect.left - 7);
          const right = Math.min(window.innerWidth - 8, rect.right + 7);
          setBox(
            bottom > top
              ? {
                  top,
                  bottom,
                  left,
                  right,
                  width: right - left,
                  height: bottom - top,
                }
              : null,
          );
          const input =
            active.kind === "field" ? fields[active.fieldIndex ?? 0] : null;
          setFieldBox(input ? input.getBoundingClientRect() : null);
          const width = Math.min(370, window.innerWidth - 28);
          const height = card.current?.getBoundingClientRect().height || 360;
          // Place the card beside the target when possible, otherwise above or below it.
          let x = window.innerWidth - width - 20;
          let y = Math.max(90, (window.innerHeight - height) / 2);
          if (window.innerWidth < 700) {
            x = (window.innerWidth - width) / 2;
            y =
              bottom + height + 20 < window.innerHeight
                ? bottom + 16
                : Math.max(12, top - height - 16);
          } else if (right + width + 24 < window.innerWidth) x = right + 18;
          else if (left > width + 24) x = left - width - 18;
          else
            y =
              bottom + height + 20 < window.innerHeight
                ? bottom + 16
                : Math.max(12, top - height - 16);
          setCardPosition({
            left: x,
            top: Math.min(
              Math.max(12, y),
              Math.max(12, window.innerHeight - height - 12),
            ),
          });
          setReady(true);
        };
        measure();
        resize = new ResizeObserver(measure);
        resize.observe(root);
        window.addEventListener("resize", measure);
        observer = new MutationObserver(() => {
          clearTimeout(scanTimer);
          scanTimer = window.setTimeout(() => {
            const count = [
              ...root.querySelectorAll<HTMLElement>(fieldSelector),
            ].filter((field) => field.getClientRects().length).length;
            if (active.kind === "page" && count !== fields.length) {
              observer?.disconnect();
              resize?.disconnect();
              cleanupMeasure();
              discovered.current.delete(active.id);
              scan();
            } else measure();
          }, 80);
        });
        observer.observe(root, { childList: true, subtree: true });
        cleanupMeasure = () => window.removeEventListener("resize", measure);
      }, 80);
    };
    let cleanupMeasure = () => {};
    const timer = window.setTimeout(scan, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(scanTimer);
      observer?.disconnect();
      resize?.disconnect();
      cleanupMeasure();
    };
  }, [active?.id]);

  useEffect(() => {
    setTyped("");
    if (!active?.example) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(active.example);
      return;
    }
    let count = 0;
    const interval = window.setInterval(() => {
      count++;
      setTyped(active.example!.slice(0, count));
      if (count >= active.example!.length) clearInterval(interval);
    }, 45);
    return () => clearInterval(interval);
  }, [active?.id]);

  function finish() {
    try {
      if (!accountMode) localStorage.setItem(storageKey, "done");
    } catch {
      /* Storage is optional. */
    }
    setIndex(null);
    setBox(null);
    onMenuChange?.(false);
    if (!accountMode && origin.current !== location.hash)
      location.hash = origin.current || "#overview";
  }

  return (
    <>
      <button
        type="button"
        ref={launcher}
        className="tour-launch"
        onClick={() =>
          accountMode ? begin("page") : chooser.current?.showModal()
        }
        aria-label={
          accountMode
            ? "Explain this account form"
            : "Start guided page and form tour"
        }
      >
        <span aria-hidden="true">✧</span>
        <span>{accountMode ? "Explain this form" : "Take a tour"}</span>
      </button>
      {createPortal(
        <>
          <dialog
            ref={chooser}
            className="tour-choice"
            aria-labelledby="tour-choice-title"
            aria-describedby="tour-choice-description"
            onCancel={() => {
              try {
                localStorage.setItem(storageKey, "seen");
              } catch {
                /* Storage is optional. */
              }
            }}
          >
            <div className="tour-meta">
              <span>EXPLORE AT YOUR PACE</span>
              <button
                type="button"
                aria-label="Close tour options"
                onClick={() => {
                  chooser.current?.close();
                  try {
                    localStorage.setItem(storageKey, "seen");
                  } catch {
                    /* Storage is optional. */
                  }
                }}
              >
                ×
              </button>
            </div>
            <h2 id="tour-choice-title">What would you like to explore?</h2>
            <p id="tour-choice-description">
              Choose a quick guide for this page or a walkthrough of your
              workspace.
            </p>
            <button
              type="button"
              className="tour-choice-option"
              onClick={() => begin("page")}
            >
              <span aria-hidden="true">◉</span>
              <span>
                <strong>This page</strong>
                <small>
                  {accountMode
                    ? "Explain this account form"
                    : `Explain ${navigation.find((item) => item.id === (location.hash.slice(1) || "overview"))?.label || "this page"} and its available form fields. Stay right here.`}
                </small>
              </span>
              <span aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              className="tour-choice-option"
              onClick={() => begin("all")}
            >
              <span aria-hidden="true">◫</span>
              <span>
                <strong>Entire workspace</strong>
                <small>
                  Visit every page available to your role, including forms and
                  examples.
                </small>
              </span>
              <span aria-hidden="true">→</span>
            </button>
            <p className="tour-choice-note">
              You can stop at any time. Tours never submit forms.
            </p>
          </dialog>
          <dialog
            ref={dialog}
            className="tour-dialog tour-v2"
            onCancel={(event) => {
              event.preventDefault();
              finish();
            }}
            aria-labelledby="tour-title"
            aria-describedby="tour-description"
          >
            {box ? (
              <div
                className="tour-spotlight"
                aria-hidden="true"
                style={{
                  top: box.top,
                  left: box.left,
                  width: box.width,
                  height: box.height,
                }}
              />
            ) : (
              <div className="tour-shade" aria-hidden="true" />
            )}
            {active?.kind === "field" && fieldBox && (
              <div
                className="tour-field-demo"
                aria-hidden="true"
                style={{
                  top: fieldBox.top,
                  left: fieldBox.left,
                  width: fieldBox.width,
                  minHeight: fieldBox.height,
                }}
              >
                <span>
                  {active.inputType === "password"
                    ? "•".repeat(typed.length)
                    : typed}
                  <i />
                </span>
                <small>Example only · not saved</small>
              </div>
            )}
            <section
              ref={card}
              className="tour-card"
              style={
                cardPosition
                  ? {
                      left: cardPosition.left,
                      top: cardPosition.top,
                      bottom: "auto",
                      transform: "none",
                    }
                  : undefined
              }
            >
              <div className="tour-meta">
                <span>
                  {accountMode ? "ACCOUNT FORM GUIDE" : "PAGE & FORM GUIDE"}
                </span>
                <button type="button" onClick={finish} aria-label="Close tour">
                  ×
                </button>
              </div>
              <div key={active?.id} className="tour-copy">
                <h2 id="tour-title">{active?.title}</h2>
                <p id="tour-description">{active?.copy}</p>
              </div>
              {active?.example && (
                <div className="tour-example">
                  <span>DEMONSTRATION</span>
                  <code>
                    {active.inputType === "password"
                      ? "•".repeat(typed.length)
                      : typed || " "}
                  </code>
                  <small>Example values never replace your inputs.</small>
                </div>
              )}
              <div className="tour-count">
                Step {(index ?? 0) + 1} of {steps.length}
                {active?.route
                  ? ` · ${active.route === "auth" ? "Your account" : navigation.find((item) => item.id === active.route)?.label || active.route}`
                  : ""}
              </div>
              <div className="tour-actions">
                <button type="button" onClick={finish} className="tour-skip">
                  Skip tour
                </button>
                <div>
                  {index !== null && index > 0 && (
                    <button
                      type="button"
                      className="button button-outline"
                      onClick={() => setIndex(index - 1)}
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!ready}
                    className="button button-primary"
                    onClick={() =>
                      index === steps.length - 1
                        ? finish()
                        : setIndex((index ?? 0) + 1)
                    }
                  >
                    {index === steps.length - 1
                      ? "Finish"
                      : index === 0
                        ? "Show me"
                        : "Next"}{" "}
                    →
                  </button>
                </div>
              </div>
            </section>
          </dialog>
        </>,
        document.body,
      )}
    </>
  );
}
