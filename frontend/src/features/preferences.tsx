import { useEffect, useState } from "react";
import { api } from "../lib/api";
import "./preferences.css";

type Channel = "IN_APP" | "PUSH" | "SMS" | "USSD";
type Preference = { channel: Channel; enabled: boolean };
const channels: {
  id: Channel;
  title: string;
  description: string;
  icon: string;
  available: boolean;
}[] = [
  {
    id: "IN_APP",
    title: "In-app notifications",
    description:
      "Get updates about your reports and work in your HydroJimma inbox.",
    icon: "✉",
    available: true,
  },
  {
    id: "PUSH",
    title: "Push notifications",
    description:
      "Device alerts are not currently delivered. Use your in-app inbox for updates.",
    icon: "◉",
    available: false,
  },
  {
    id: "SMS",
    title: "Text messages",
    description:
      "SMS notifications are not available yet. Phone verification is separate from this setting.",
    icon: "▤",
    available: false,
  },
  {
    id: "USSD",
    title: "USSD notifications",
    description:
      "Proactive USSD notifications are not currently delivered. The phone-based service remains separate.",
    icon: "⌁",
    available: false,
  },
];

export function Preferences() {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Channel | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Preference[]>("/notifications/preferences")
      .then((result) => {
        if (active) setPreferences(result);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  async function update(channel: Channel, enabled: boolean) {
    setSaving(channel);
    setError("");
    setSaved(false);
    try {
      const updated = await api<Preference>("/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({ channel, enabled }),
      });
      setPreferences((previous) =>
        previous.map((row) => (row.channel === channel ? updated : row)),
      );
      setSaved(true);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="preferences-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR ACCOUNT / SETTINGS</p>
          <h1>
            A little less noise.
            <br className="preferences-mobile-break" /> More of what matters.
          </h1>
          <p>Choose where HydroJimma sends your updates.</p>
        </div>
        <span className="preferences-autosave">
          <span aria-hidden="true">✓</span> Changes save automatically
        </span>
      </div>
      <div className="preferences-layout">
        <section
          className="panel preferences-card"
          aria-labelledby="delivery-heading"
          aria-busy={loading}
        >
          <header className="preferences-card-header">
            <span className="preferences-heading-icon" aria-hidden="true">
              ✉
            </span>
            <div>
              <h2 id="delivery-heading">Notification channels</h2>
              <p>Keep in touch, on your terms.</p>
            </div>
          </header>
          {loading ? (
            <div className="preferences-loading" role="status">
              <span className="loading-spinner" aria-hidden="true" /> Loading
              your preferences…
            </div>
          ) : (
            <div className="preferences-channel-list">
              {channels.map((channel) => {
                const preference = preferences.find(
                  (row) => row.channel === channel.id,
                );
                const enabled =
                  channel.available && Boolean(preference?.enabled);
                const disabled =
                  !channel.available || !preference || saving !== null;
                return (
                  <div
                    className={`preference-row ${!channel.available ? "preference-unavailable" : ""}`}
                    key={channel.id}
                  >
                    <span className="preference-icon" aria-hidden="true">
                      {channel.icon}
                    </span>
                    <div className="preference-copy">
                      <div className="preference-title">
                        <h3 id={`channel-title-${channel.id}`}>
                          {channel.title}
                        </h3>
                        {!channel.available && (
                          <span className="preference-badge">
                            Not available yet
                          </span>
                        )}
                      </div>
                      <p id={`channel-description-${channel.id}`}>
                        {channel.description}
                      </p>
                      {channel.available && (
                        <small className={enabled ? "preference-enabled" : ""}>
                          {saving === channel.id
                            ? "Saving your preference…"
                            : enabled
                              ? "On · delivered to your inbox"
                              : "Off · in-app updates paused"}
                        </small>
                      )}
                    </div>
                    <label
                      className="preference-switch"
                      title={
                        !channel.available
                          ? "This delivery channel is not available yet"
                          : `Turn ${channel.title.toLowerCase()} ${enabled ? "off" : "on"}`
                      }
                    >
                      <input
                        type="checkbox"
                        role="switch"
                        name={channel.id}
                        checked={enabled}
                        disabled={disabled}
                        aria-labelledby={`channel-title-${channel.id}`}
                        aria-describedby={`channel-description-${channel.id}`}
                        data-tour-description={
                          channel.available
                            ? "Turn in-app notifications on to receive updates in your inbox, or off to pause them. Changes save automatically. The guide does not change this setting."
                            : channel.description
                        }
                        data-tour-example={
                          channel.available
                            ? "On · receive in-app updates"
                            : "Unavailable · no change can be made"
                        }
                        onChange={(event) =>
                          update(channel.id, event.target.checked)
                        }
                      />
                      <span aria-hidden="true" />
                    </label>
                  </div>
                );
              })}
            </div>
          )}
          <footer className="preferences-card-footer">
            <span aria-hidden="true">ⓘ</span>
            <p>
              These settings control notification delivery. They don’t change
              your account access or phone verification.
            </p>
          </footer>
        </section>
        <aside className="preferences-context">
          <p className="eyebrow">GOOD TO KNOW</p>
          <h2>
            Your inbox,
            <br />
            at your pace.
          </h2>
          <p>
            Review updates about your reports and assigned work whenever you’re
            ready.
          </p>
          <a className="button button-outline" href="#inbox">
            Open my inbox <span aria-hidden="true">→</span>
          </a>
          <div className="preferences-context-note">
            <span aria-hidden="true">✓</span>
            <p>
              Switching a channel off won’t delete notifications already in your
              inbox.
            </p>
          </div>
        </aside>
      </div>
      <div
        className="preferences-feedback"
        aria-live="polite"
        aria-atomic="true"
      >
        {saved && !error && (
          <p className="success">
            ✓ Your notification preference has been saved.
          </p>
        )}
      </div>
      {error && (
        <div className="preferences-error">
          <p className="alert" role="alert">
            {error}
          </p>
          {!preferences.length && (
            <button
              className="button button-outline"
              onClick={() => setAttempt(attempt + 1)}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
