# Municipal web workflows

The web dispatcher now connects the operational APIs rather than exposing only administrative lists. Mobile applications are outside this implementation.

## Workflows

- **Leak investigation:** severity/status filters, paginated incidents, report evidence and photo links, location, confidence, triage decisions and linked work orders. Administrators and dispatchers triage; field technicians inspect read-only evidence.
- **Maintenance:** create, edit, assign and schedule work; inspect status history; acknowledge, start, hold and complete repairs. Technicians/operators only act on their assigned orders. Completion requires a resolution note. Version tokens protect concurrent edits.
- **Rotations:** create/edit multi-window drafts, pressure targets and notes, publish, activate, cancel and complete; inspect the date-filtered agenda; operate individual windows during valid time bounds. Civil dates are stored as UTC-midnight Date values for PostgreSQL date columns. Date filters include plans spanning the selected date.
- **Schedule clock:** every 10 seconds, reconcile due windows of already-active schedules. Draft/published schedules are not automatically activated. Database transactions and version predicates prevent duplicate concurrent transitions. Opening/closing events are written in the same transaction. Set `SCHEDULE_CLOCK_ENABLED=false` to disable the clock.
- **Water alerts:** Preferences selects the account's kebele, also used by USSD. Opening/closing events target active residents of that kebele and relevant active standpipe operators. In-app and SMS preferences are independent. SMS requires explicit opt-in and the HTTP adapter.
- **Monitoring:** a georeferenced observation heatmap, measured pressure history and 24-hour summaries; separate crowd-consensus and queue layer; refresh every 30 seconds while visible. Administrators/dispatchers can register named monitoring points at standpipes directly in the web; manual measurements do not require IoT hardware. Selected rotation windows refresh every 10 seconds. Data older than one hour is labeled stale. Unknown is never treated as zero or healthy.
- **Spatial evidence:** same-kebele standpipe reports within 500 metres contribute distance-decayed evidence at at most half the direct-observation weight. Reliability, recency and priors remain part of the consensus calculation. A new report recalculates nearby standpipe snapshots.
- **Session lifecycle:** ordinary API requests refresh an expired token once, sharing one refresh across concurrent failures. A revoked session clears the UI account state. A real 403 does not log the user out. Startup validates the saved account against `/auth/me`.

## Interface refinements

Shared form grids align labels, controls and help text across columns; record searches sit below their selectors. Tours cover the latest repair, triage, rotation and monitoring workflows with role-filtered, isolated demonstration forms that cannot save data.

The monitoring map uses Leaflet with geographic street tiles, selectable observations, pressure history, name/freshness filters, fit and expanded views, and external location links. Gray observations are stale or unavailable. It is not an interpolated hydraulic model. The default OpenStreetMap street tiles require an internet connection; configure `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION` at build time for another provider. Retain attribution and comply with the chosen provider's usage policy. Tile failures leave the observation list and coordinates available.

A water-style page rail supports dragging, track clicks, arrow keys, Page Up/Down and Home/End. Nested panels retain thin native scrollbars. Reduced-motion preferences disable decorative animation, and forced-colors mode restores the native page scrollbar.

## Regression checks

With the local frontend on port 3001 and Chromium debugging on `127.0.0.1:9335`, run `npm --prefix frontend run test:ui` for read-only fixture-based browser coverage of alignment, marker selection, map search/zoom, scroll keyboard controls, current-page workflow tours and mobile overflow. This opens and closes its own browser tab, blocks API writes and uses no real credentials. It complements, rather than replaces, the live backend workflow checks below.

Run `npm --prefix frontend test`, `npm --prefix frontend run check`, and the backend test, lint and build scripts. Regression coverage includes role visibility, order/window action eligibility, stale map data, concurrent token refresh, spatial weighting, raw-body USSD signatures, targeted water alerts and schedule-clock overlap protection.

Live local browser/API checks exercised expired-token recovery; leak evidence and triage; linked work-order creation, assignment and completion; multi-window draft creation/edit/publication/activation; timed opening; targeted opening and closing inbox alerts; and the monitoring/preferences/gateway pages. Isolated QA records were removed after verification.

For a repeatable live run, start the local backend on port 3000, frontend on 3001, and a Chromium browser with its debugging endpoint on `127.0.0.1:9335`. Set `HYDRO_QA_ALLOW_MUTATIONS=local`, `HYDRO_QA_PHONE` and `HYDRO_QA_PASSWORD` to a local administrator, then run `npm --prefix backend run test:web-smoke`. The test refuses a non-local database, opens its own browser tab, creates isolated QA records, restores the administrator's preferences and removes the records it created. It never attempts a real carrier SMS.

## Deployment checks still required

1. Configure `SMS_PROVIDER=http`, `SMS_API_URL`, `SMS_API_KEY` and a compatible provider contract. `log` mode does not send carrier messages. The gateway page reports configuration, not verified delivery. Test delivery on a real handset before launch.
2. Configure `USSD_CALLBACK_SECRET`, the provider's public HTTPS callback URL and shortcode. Sign `timestamp.rawBody` with HMAC-SHA256, using the exact HTTP request bytes; include `x-ussd-timestamp` and `x-ussd-signature`. Check the registered and unregistered caller flows with the carrier.
3. Set the municipal timezone consistently and test midnight windows. Activate intended plans explicitly; keep the clock and outbox worker running.
4. Validate geography, staffing assignments and pressure thresholds with the utility. The pressure warning bands are currently below 1.5 bar / 1.5–5 bar / above 5 bar; these are display bands, not an engineering safety certification.
5. This is an observation layer, not a hydraulic simulation or proof of a remote valve actuator. Colored halos do not invent measured pressure between observations; flow consensus is not expressed in bar. Physical hardware and carrier delivery need separate acceptance testing.
