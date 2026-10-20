import type { ReactNode } from "react";
import { human } from "../lib/dispatch";
export function Badge({ value }: { value: string }) {
  return (
    <span className={`dispatch-badge dispatch-${value.toLowerCase()}`}>
      {human(value)}
    </span>
  );
}
export function Pager({
  page,
  pages = 1,
  onChange,
}: {
  page: number;
  pages?: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="dispatch-toolbar">
      <button
        className="button button-outline"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {Math.max(1, pages)}
      </span>
      <button
        className="button button-outline"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
export function DispatchPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="dispatch-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MUNICIPAL OPERATIONS</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
