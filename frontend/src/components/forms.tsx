import {
  cloneElement,
  useEffect,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import "./forms.css";

export function FormLayout({
  eyebrow = "WORKSPACE",
  title,
  description,
  help,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  help: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="workflow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="workflow-layout">
        <div className="workflow-content">{children}</div>
        <aside className="workflow-help">
          <span className="workflow-help-icon" aria-hidden="true">
            ✧
          </span>
          <h2>A little guidance</h2>
          {help}
          <p className="workflow-tour-tip">
            Need a walkthrough? Choose <strong>Take a tour → This page</strong>{" "}
            above.
          </p>
        </aside>
      </div>
    </div>
  );
}
export function FormSection({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="workflow-section">
      <legend>
        <span>{number}</span>
        {title}
      </legend>
      {description && (
        <p className="workflow-section-description">{description}</p>
      )}
      <div className="workflow-fields">{children}</div>
    </fieldset>
  );
}
export function FormField({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const id = useId();
  return (
    <div className="workflow-field">
      <label htmlFor={id}>
        {label}
        {optional && <span className="optional-label">Optional</span>}
      </label>
      {cloneElement(children, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
type Choice = {
  id: string;
  name?: string;
  displayName?: string;
  code?: string;
  type?: string;
};
export function RecordPicker({
  endpoint,
  label,
  name,
  hint,
  required = true,
  disabled = false,
  onChange,
  initialValue = "",
}: {
  endpoint: string;
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  onChange?: (value: string) => void;
  initialValue?: string;
}) {
  const [items, setItems] = useState<Choice[]>([]);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    async function load() {
      const all: Choice[] = [];
      let page = 1;
      while (true) {
        const result = await api<{
          items: Choice[];
          total?: number;
          meta?: { totalPages: number };
        }>(
          `${endpoint}${endpoint.includes("?") ? "&" : "?"}limit=100&page=${page}`,
        );
        all.push(...result.items);
        if (
          result.meta
            ? page >= result.meta.totalPages
            : result.total !== undefined
              ? all.length >= result.total
              : result.items.length < 100
        )
          break;
        if (!active) return;
        page++;
      }
      if (active) {
        setItems(all);
        setLoading(false);
      }
    }
    load().catch((failure) => {
      if (active) {
        setError(failure.message);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [endpoint, attempt]);
  const filtered = items.filter(
    (item) =>
      item.id === value ||
      `${item.name || item.displayName || ""} ${item.code || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="record-picker">
      {items.length > 8 && (
        <label className="record-search">
          Search {label.toLowerCase()}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or code"
            disabled={disabled}
          />
        </label>
      )}
      <FormField
        label={label}
        optional={!required}
        hint={
          hint ||
          "Choose the record by its name. Its ID is handled automatically."
        }
      >
        <select
          name={name}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            onChange?.(event.target.value);
          }}
          required={required}
          disabled={disabled || loading || Boolean(error)}
          aria-busy={loading}
        >
          <option value="">
            {loading
              ? "Loading options…"
              : items.length
                ? `Choose ${label.toLowerCase()}`
                : "No records available"}
          </option>
          {filtered.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || item.displayName || item.code || item.id}
              {item.code && item.name ? ` · ${item.code}` : ""}
            </option>
          ))}
        </select>
      </FormField>
      {!loading && !items.length && !error && (
        <p className="workflow-notice">
          No options have been added yet. Ask your administrator to add a record
          first.
        </p>
      )}
      {error && (
        <div className="workflow-picker-error">
          <span role="alert">{error}</span>
          <button type="button" onClick={() => setAttempt(attempt + 1)}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
export function FormFeedback({
  error,
  message,
}: {
  error?: string;
  message?: string;
}) {
  return (
    <>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
    </>
  );
}
export function FormActions({
  busy,
  label,
  children,
}: {
  busy: boolean;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="workflow-actions">
      <small>Review your details before saving.</small>
      <div>
        {children}
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? (
            <>
              <span className="loading-spinner" aria-hidden="true" />
              Saving…
            </>
          ) : (
            <>
              {label}
              <span aria-hidden="true">→</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
