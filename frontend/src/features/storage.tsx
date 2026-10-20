import { useState } from "react";
import { api, getSession } from "../lib/api";
import { canReadAttachment, ownsAttachment } from "../lib/permissions";
import {
  FormFeedback,
  FormField,
  FormLayout,
  FormSection,
} from "../components/forms";

export function StorageAdmin() {
  const [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [url, setUrl] = useState("");
  const session = getSession();
  const readable = canReadAttachment(key, session);
  const owned = ownsAttachment(key, session);
  return (
    <FormLayout
      eyebrow="YOUR ACCOUNT / ATTACHMENTS"
      title="Manage an attachment"
      description="Open an uploaded file or remove one you no longer need."
      help={
        <>
          <p>
            The attachment key identifies a specific uploaded file. Copy it
            exactly from the upload or report record.
          </p>
          <p>
            Opening a file does not change it. Deletion permanently removes the
            stored object, so review the key first.
          </p>
        </>
      }
    >
      <form
        className="workflow-form"
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!readable) {
            setError(
              "You can only open your own attachments unless your role permits reviewing reports.",
            );
            return;
          }
          setBusy(true);
          setError("");
          setMessage("");
          setUrl("");
          try {
            const result = await api<{ url: string }>(
              `/storage/download/${encodeURIComponent(key.trim())}`,
            );
            setUrl(result.url);
            setMessage("Your attachment link is ready. Open it below.");
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormSection number="01" title="Find the file">
          <FormField
            label="Attachment key"
            hint="Use the key from the uploaded attachment, not a file name or web address."
          >
            <input
              name="objectKey"
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
                setUrl("");
                setConfirm(false);
                setMessage("");
              }}
              placeholder="leaks/account-id/year/month/photo.jpg"
              required
              maxLength={512}
              disabled={busy}
            />
          </FormField>
        </FormSection>
        <FormFeedback error={error} message={message} />
        {url && (
          <a
            className="button button-outline"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open attachment ↗
          </a>
        )}
        <div className="workflow-actions">
          <small>
            {!key.trim()
              ? "Enter an attachment key to see available actions."
              : readable
                ? "Access permissions are checked before opening."
                : "This attachment is not available to your account."}
          </small>
          {readable && (
            <div>
              <button
                className="button button-primary"
                type="submit"
                disabled={busy}
              >
                {busy ? "Preparing…" : "Get attachment link →"}
              </button>
            </div>
          )}
        </div>
      </form>
      {owned && (
        <section className="panel workflow-records">
          <div className="workflow-card-header">
            <h2>Remove an attachment</h2>
          </div>
          <p className="workflow-section-description">
            Only delete a file when you are sure it is no longer needed.
          </p>
          {!confirm ? (
            <button
              className="button button-outline workflow-danger"
              disabled={busy || !key.trim()}
              onClick={() => setConfirm(true)}
            >
              Delete this attachment
            </button>
          ) : (
            <div className="workflow-confirm">
              <p>
                Permanently delete <strong>{key}</strong>? This cannot be
                undone.
              </p>
              <button
                className="button button-outline"
                onClick={() => setConfirm(false)}
                disabled={busy}
              >
                Keep attachment
              </button>
              <button
                className="button button-primary workflow-danger"
                disabled={busy}
                onClick={async () => {
                  if (!ownsAttachment(key, getSession())) return;
                  setBusy(true);
                  setError("");
                  setMessage("");
                  try {
                    await api(
                      `/storage/objects/${encodeURIComponent(key.trim())}`,
                      { method: "DELETE" },
                    );
                    setConfirm(false);
                    setUrl("");
                    setMessage("Attachment deleted.");
                  } catch (failure) {
                    setError((failure as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete permanently
              </button>
            </div>
          )}
        </section>
      )}
    </FormLayout>
  );
}
