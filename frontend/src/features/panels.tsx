import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { DataTable } from "../components/ui";
export { DataTable as Table } from "../components/ui";
type Row = Record<string, any>;
function useRows(endpoint: string) {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    setError("");
    return api<{ items: Row[] }>(endpoint)
      .then((result) => setRows(result.items))
      .catch((failure) => setError(failure.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, [endpoint]);
  return { rows, error, loading, load };
}
export function Resource({
  endpoint,
  heading,
  columns,
}: {
  endpoint: string;
  heading: string;
  columns: [string, string][];
}) {
  const data = useRows(endpoint);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h1>{heading}</h1>
        <button
          className="button button-outline"
          onClick={data.load}
          disabled={data.loading}
        >
          {data.loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {data.error && (
        <p className="alert" role="alert">
          {data.error}
        </p>
      )}
      <DataTable rows={data.rows} columns={columns} />
      {!data.loading && !data.error && !data.rows.length && (
        <p className="empty-state">No records to show yet.</p>
      )}
    </section>
  );
}
export function WorkOrders() {
  const data = useRows("/work-orders?limit=100&page=1");
  return (
    <section className="panel">
      <h1>Work orders</h1>
      {data.error && (
        <p className="alert" role="alert">
          {data.error}
        </p>
      )}
      <DataTable
        rows={data.rows}
        columns={[
          ["title", "Title"],
          ["priority", "Priority"],
          ["status", "Status"],
        ]}
      />
    </section>
  );
}
export function Notifications() {
  const data = useRows("/notifications?limit=100"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  return (
    <section className="panel">
      <h1>Inbox</h1>
      {(error || data.error) && (
        <p className="alert" role="alert">
          {error || data.error}
        </p>
      )}
      <DataTable
        rows={data.rows}
        columns={[
          ["title", "Title"],
          ["body", "Message"],
          ["createdAt", "Received"],
        ]}
        action={(row) =>
          row.readAt ? (
            <span>Read</span>
          ) : (
            <button
              className="button button-outline"
              disabled={busy === row.id}
              onClick={async () => {
                setBusy(row.id);
                setError("");
                try {
                  await api(`/notifications/${row.id}/read`, {
                    method: "PATCH",
                  });
                  await data.load();
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Mark read
            </button>
          )
        }
      />
      {!data.loading && !data.rows.length && !data.error && (
        <p className="empty-state">
          You’re all caught up. Updates for your account will appear here.
        </p>
      )}
    </section>
  );
}
