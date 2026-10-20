import { useState, type FormEvent } from "react";
import {
  register,
  requestOtp,
  signIn,
  verifyOtp,
  getSession,
  type Session,
} from "../lib/api";
import { ThemeToggle } from "../components/ThemeToggle";
import { GuidedTour } from "../components/GuidedTour";

export function AuthPage({
  onAuthenticated,
}: {
  onAuthenticated: (session: Session) => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "verify">("login");
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (mode === "verify") {
        await verifyOtp(challenge, String(data.get("code")));
        const next = getSession();
        if (next) onAuthenticated(next);
        else {
          setMode("login");
          setNotice("Phone verified. Sign in to continue.");
        }
      } else if (mode === "login") {
        onAuthenticated(
          await signIn(phone.trim(), String(data.get("password"))),
        );
      } else {
        await register(
          String(data.get("displayName")).trim(),
          phone.trim(),
          String(data.get("password")),
        );
        setMode("verify");
        const result = await requestOtp(phone.trim());
        setChallenge(result.challengeId);
        setNotice("Your account is ready. Enter the code sent to your phone.");
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError("");
    try {
      const result = await requestOtp(phone.trim());
      setChallenge(result.challengeId);
      setNotice("A new verification code has been sent.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-page">
      <header className="account-header">
        <a className="brand" href="#overview">
          <span className="brand-logo">≈</span>
          <span>
            <strong>HydroJimma.</strong>
            <small>Water, together.</small>
          </span>
        </a>
        <div>
          <a className="account-back" href="#overview">
            ← Back to community
          </a>
          <ThemeToggle />
          <GuidedTour key={mode} session={null} accountMode={mode} />
        </div>
      </header>
      <main className="account-main">
        <section className="account-story" aria-label="Welcome to HydroJimma">
          <span className="story-location">
            JIMMA, ETHIOPIA · CONNECTED BY WATER
          </span>
          <div className="account-water" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>≈</span>
          </div>
          <h1>
            A little connection.
            <br />A better everyday.
          </h1>
          <p>
            Know where water is flowing. Share a helpful update.
            <br />
            Look out for your community.
          </p>
          <div className="story-features">
            <span>◉ Local water points</span>
            <span>⌁ Community updates</span>
            <span>✓ A shared purpose</span>
          </div>
        </section>
        <section className="account-form-area">
          <div className="account-card">
            <p className="eyebrow">
              {mode === "verify"
                ? "ONE LAST STEP"
                : "WELCOME TO YOUR COMMUNITY"}
            </p>
            <h2>
              {mode === "login"
                ? "Good to see you again."
                : mode === "register"
                  ? "Let’s get you connected."
                  : "Verify your phone."}
            </h2>
            <p className="account-subtitle">
              {mode === "login"
                ? "Sign in to get updates and share what you see."
                : mode === "register"
                  ? "Create an account to help keep your community informed."
                  : `Enter the six-digit code sent to ${phone}.`}
            </p>
            {mode !== "verify" && (
              <div className="account-tabs" aria-label="Account options">
                {(["login", "register"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    aria-pressed={mode === tab}
                    className={mode === tab ? "selected" : ""}
                    onClick={() => {
                      setMode(tab);
                      setError("");
                      setNotice("");
                    }}
                  >
                    {tab === "login" ? "Sign in" : "Create account"}
                  </button>
                ))}
              </div>
            )}
            <form
              key={mode}
              onSubmit={submit}
              className="account-form"
              aria-busy={busy}
            >
              {mode === "register" && (
                <label htmlFor="account-name">
                  Your name
                  <input
                    id="account-name"
                    name="displayName"
                    autoComplete="name"
                    placeholder="How should we call you?"
                    maxLength={120}
                    required
                    disabled={busy}
                  />
                </label>
              )}
              {mode !== "verify" && (
                <>
                  <label htmlFor="account-phone">
                    Phone number
                    <input
                      id="account-phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="+251 900 000 000"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label htmlFor="account-password">
                    Password
                    <span className="password-control">
                      <input
                        id="account-password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete={
                          mode === "login" ? "current-password" : "new-password"
                        }
                        placeholder={
                          mode === "login"
                            ? "Enter your password"
                            : "Choose a strong password"
                        }
                        required
                        disabled={busy}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </span>
                  </label>
                </>
              )}
              {mode === "verify" && (
                <label htmlFor="account-code">
                  Verification code
                  <input
                    className="otp-input"
                    id="account-code"
                    name="code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="000000"
                    required
                    disabled={busy}
                  />
                </label>
              )}
              {error && (
                <p className="alert" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="success" role="status">
                  {notice}
                </p>
              )}
              <button
                className="button button-primary account-submit"
                disabled={busy || (mode === "verify" && !challenge)}
              >
                {busy ? (
                  <>
                    <span className="loading-spinner" aria-hidden="true" />{" "}
                    Please wait…
                  </>
                ) : (
                  <>
                    {mode === "login"
                      ? "Sign in"
                      : mode === "register"
                        ? "Create your account"
                        : "Verify & continue"}{" "}
                    <span aria-hidden="true">→</span>
                  </>
                )}
              </button>
            </form>
            {mode === "verify" && (
              <button
                type="button"
                className="account-resend"
                disabled={busy}
                onClick={resend}
              >
                Send a new code
              </button>
            )}
            <p className="account-note">
              Your updates help make water access a little easier for everyone.
            </p>
          </div>
        </section>
      </main>
      <footer className="account-footer">
        HydroJimma · Built around our community.
      </footer>
    </div>
  );
}
