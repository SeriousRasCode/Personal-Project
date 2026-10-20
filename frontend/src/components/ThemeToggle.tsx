import { useEffect, useState } from "react";

const storageKey = "hydrojimma.theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "dark" || saved === "light") return saved === "dark";
    } catch {
      /* Use system preference if storage is unavailable. */
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#111e25" : "#f7f9f8");
    try {
      localStorage.setItem(storageKey, dark ? "dark" : "light");
    } catch {
      /* Theme still works for this session. */
    }
  }, [dark]);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setDark(!dark)}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to night mode"}
      title={dark ? "Switch to light mode" : "Switch to night mode"}
    >
      <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
      <span className="theme-toggle-label">
        {dark ? "Day mode" : "Night mode"}
      </span>
    </button>
  );
}
