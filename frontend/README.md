# HydroJimma frontend

A responsive citizen portal for the HydroJimma API. It shows public standpipes
and active leak areas, lets verified users report water flow, queue waits, and
leaks, and displays their notifications.

## Run locally

1. Start the backend on `http://localhost:3000` using the steps in
   [backend/README.md](../backend/README.md). Its `CORS_ORIGINS` should include
   `http://localhost:3001`, as in the backend example environment.
2. From this directory run `npm install` and then `npm run dev` (Node.js 22.12 or newer).
   Start the backend separately. PostgreSQL and Redis must be running.
3. Open `http://localhost:3001`.

The frontend uses the standard Vite React TypeScript template. Vite proxies
`/api/v1` to the backend during development.

Run `npm run check` for TypeScript validation and a production build.

New citizens register, request a phone verification code, and enter it in the
dialog. The backend's default `log` SMS provider writes the code to the backend
console during local development. A real SMS provider is needed for live users.

Photos are uploaded directly to S3 or LocalStack using short-lived URLs. The
browser needs the storage bucket to allow the frontend origin and expose the
`ETag` response header for multipart uploads. A signed-in user can attach an
uploaded photo to a leak report.

The React app exposes the citizen portal plus role-aware staff navigation for
operations, telemetry, maintenance, schedules, and administration. Backend
authorization remains authoritative for every request.
