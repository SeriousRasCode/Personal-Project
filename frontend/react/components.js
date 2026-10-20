import React from "react";

const h = React.createElement;

export function Card({ label, value, children }) {
  return h("article", { className: "info-card" }, h("p", { className: "eyebrow" }, label), value !== undefined && h("h2", null, value), children);
}

export function ErrorMessage({ error }) {
  return error && h("p", { className: "alert", role: "alert" }, error.message || String(error));
}

export function DataTable({ rows = [], columns = [], actions }) {
  return h("div", { className: "table-wrap" }, h("table", null,
    h("thead", null, h("tr", null, columns.map(([key, label]) => h("th", { key }, label)), actions && h("th", null, "Actions"))),
    h("tbody", null, rows.map((row, index) => h("tr", { key: row.id || index }, columns.map(([key]) => h("td", { key }, String(row[key] ?? "—"))), actions && h("td", null, actions(row))))),
  ));
}

export function PageHeader({ eyebrow, title, description, action }) {
  return h("div", { className: "panel-heading" }, h("div", null, eyebrow && h("p", { className: "eyebrow" }, eyebrow), h("h1", null, title), description && h("p", { className: "muted" }, description)), action);
}

export function FormField({ label, children }) {
  return h("label", null, label, children);
}
