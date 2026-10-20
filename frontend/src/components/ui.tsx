import type { ReactNode } from 'react';

export function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="panel"><h1>{title}</h1>{children}</section>; }
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label>{label}{children}</label>; }
export function Button({ children, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' }) { return <button className={`button button-${variant}`} {...props}>{children}</button>; }
export function DataTable({ rows, columns, action }: { rows: Record<string, any>[]; columns: [string, string][]; action?: (row: Record<string, any>) => ReactNode }) { return <div className="table-wrap"><table><thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}{action && <th>Actions</th>}</tr></thead><tbody>{rows.map((row, i) => <tr key={row.id || i}>{columns.map(([key]) => <td key={key}>{String(row[key] ?? '—')}</td>)}{action && <td>{action(row)}</td>}</tr>)}</tbody></table></div>; }
