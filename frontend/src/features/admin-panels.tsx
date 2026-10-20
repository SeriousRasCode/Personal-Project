import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { Resource } from "./panels";
import { FormFeedback, FormLayout } from "../components/forms";

export function UssdSessions() {
  const [gateway, setGateway] = useState<{
    smsProvider: string;
    smsConfigured: boolean;
    ussdSignatureConfigured: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<typeof gateway>("/ussd/gateway-status")
      .then(setGateway)
      .catch((failure) => setError(failure.message));
  }, []);
  return (
    <>
      <section className="panel">
        <h1>Telephony gateway</h1>
        <FormFeedback error={error} />
        {gateway && (
          <>
            <p>
              SMS provider: <strong>{gateway.smsProvider}</strong> ·{" "}
              {gateway.smsConfigured
                ? "HTTP delivery adapter configured"
                : "Log only — no carrier SMS is sent"}
            </p>
            <p>
              USSD callback signature:{" "}
              {gateway.ussdSignatureConfigured
                ? "Configured"
                : "Not configured"}
            </p>
            <p>
              Provider configuration is not proof of carrier delivery. Verify
              the public callback URL, shortcode and handset delivery before
              launch.
            </p>
          </>
        )}
      </section>
      <Resource
        heading="USSD sessions"
        endpoint="/ussd/sessions?limit=100&page=1"
        columns={[
          ["phone", "Phone"],
          ["state", "State"],
          ["updatedAt", "Updated"],
        ]}
      />
    </>
  );
}
export function AuditLog() {
  return (
    <Resource
      heading="Activity log"
      endpoint="/audit/events?limit=100&page=1"
      columns={[
        ["createdAt", "Time"],
        ["action", "Action"],
        ["entityType", "Entity"],
        ["entityId", "Entity ID"],
      ]}
    />
  );
}
export function OutboxMonitor() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [revision, setRevision] = useState(0);
  async function perform(action: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/outbox/${action}`, { method: "POST" });
      setMessage(
        action === "dispatch"
          ? "Pending events processed. The list has been refreshed."
          : "Stale processing locks released. The list has been refreshed.",
      );
      setRevision((previous) => previous + 1);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormLayout
      eyebrow="ADMINISTRATION / EVENT DELIVERY"
      title="Keep updates moving"
      description="Inspect delivery status and run a recovery action when needed."
      help={
        <>
          <p>
            <strong>Process pending events</strong> runs the normal delivery
            process once.
          </p>
          <p>
            <strong>Release stale locks</strong> makes events with expired
            processing locks available for retry. It does not force the release
            of an active lock.
          </p>
        </>
      }
    >
      <Resource
        key={revision}
        heading="Delivery events"
        endpoint="/outbox/events?limit=100&page=1"
        columns={[
          ["createdAt", "Created"],
          ["eventType", "Type"],
          ["status", "Status"],
          ["attempts", "Attempts"],
          ["lastError", "Last error"],
        ]}
      />
      <section className="panel">
        <div className="workflow-card-header">
          <h2>Recovery actions</h2>
        </div>
        <FormFeedback error={error} message={message} />
        <div className="workflow-row-actions">
          <button
            className="button button-primary"
            disabled={busy}
            onClick={() => perform("dispatch")}
          >
            {busy ? "Working…" : "Process pending events"}
          </button>
          <button
            className="button button-outline"
            disabled={busy}
            onClick={() => perform("release-stuck")}
          >
            Release stale locks
          </button>
        </div>
      </section>
    </FormLayout>
  );
}
