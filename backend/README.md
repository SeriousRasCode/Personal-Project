# HydroJimma API

Backend API for the HydroJimma/Bishaankoo water supply monitoring platform. A modular NestJS
monolith backed by PostgreSQL/PostGIS, Redis, and BullMQ, with LocalStack standing in for S3
during local development.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer
- Docker with the Compose plugin (for PostgreSQL, Redis, and LocalStack)

## Local setup

```bash
npm install
cp .env.example .env
npm run infra:up      # postgres, redis, localstack
npm run infra:init    # one-shot: creates the S3 bucket in LocalStack
npm run db:deploy     # applies Prisma migrations
npm run db:seed       # seeds roles, a kebele hierarchy, and an admin user
npm run start:dev
```

The seeded admin credentials come from `SEED_ADMIN_PHONE` and `SEED_ADMIN_PASSWORD` in `.env`.
Sign in with `POST /api/v1/auth/login` to get an access token.

`npm run infra:reset` tears the volumes down and forces a clean database, Redis, and
LocalStack state on the next `infra:up`.

## Endpoints

| Path                     | Notes                                             |
| ------------------------ | ------------------------------------------------- |
| `/api/v1`                | Service metadata                                  |
| `/api/v1/...`            | Versioned API, described below                    |
| `/health/live`           | Liveness probe, intentionally outside the prefix  |
| `/health/ready`          | Readiness probe: PostgreSQL, Redis, queue health  |
| `/docs`                  | Swagger UI                                        |
| `/docs/openapi.json`     | Generated OpenAPI document                        |

## Modules

| Module        | Responsibility                                                     |
| ------------- | ------------------------------------------------------------------ |
| `auth`        | Registration, login, OTP, refresh, and logout token rotation        |
| `users`       | User profiles, roles, and role assignments                          |
| `audit`       | Append-only audit trail for privileged mutations                    |
| `geography`   | Regions, kebeles, neighborhoods, and boundaries with PostGIS        |
| `standpipes`  | Standpipe registry, assignments, and operators                      |
| `schedules`   | Maintenance windows and rotation schedules                          |
| `reports`     | Citizen and operator flow and queue reports                        |
| `consensus`   | Bayesian tap consensus and queue trend snapshots                   |
| `leaks`       | Citizen leak reports, spatial clustering, and public map feed      |
| `work-orders` | Repair dispatch, assignment, and the work order lifecycle          |
| `outbox`      | Transactional event dispatcher with retry, backoff, and lock recovery |
| `notifications` | In-app inbox, per-channel preferences, and idempotent delivery   |
| `telemetry`   | Sensor registry, pressure readings, and hourly aggregates          |
| `maintenance` | Pipeline and valve registry with the valve position lifecycle      |
| `sms-ussd`    | SMS provider, OTP delivery, and the USSD self-service menu            |
| `health`      | Liveness and readiness probes                                       |

`prisma` owns database access and `queues` owns the BullMQ wiring. Both are registered
globally by `AppModule`.

## Reports and consensus

A report carries a `status` (`FULL_FLOW`, `TRICKLE`, or `DRY`), an optional `observedAt`, and
an optional `reliabilityWeight`. The weight a client asks for is clamped to the ceiling of the
reporter's role, so clients cannot inflate their own influence.

Consensus is recency-weighted: each observation is discounted by a half-life over the
configured window and combined with a prior, so a single report nudges the result without
overriding older corroboration. Exact ties resolve to `UNKNOWN`.

Queue reports aggregate into periodic snapshots that expose the median wait, queue size, and
a trend classified as `IMPROVING`, `STABLE`, or `WORSE` once enough samples exist.

Tunables live in `.env` and are validated at startup: `CONSENSUS_WINDOW_HOURS`,
`CONSENSUS_HALF_LIFE_HOURS`, `CONSENSUS_PRIOR_WEIGHT`, `CONSENSUS_SATURATION_WEIGHT`,
`QUEUE_WINDOW_HOURS`, `QUEUE_MIN_SAMPLES`, `QUEUE_SATURATION_SAMPLES`,
`QUEUE_MIN_RELATIVE_DELTA`, `QUEUE_MIN_ABSOLUTE_DELTA_MINUTES`, and
`QUEUE_SNAPSHOT_MIN_INTERVAL_MINUTES`.

## Leaks and work orders

Any authenticated user can report a suspected leak. The report point is resolved to a kebele
and, when a boundary covers it, a neighborhood; otherwise the nearest kebele centre is used.
A report is attached to the nearest unresolved cluster inside its radius, or it seeds a new
one. Clustering is pure and unit tested in `leaks/leak-clustering.ts`:

- the cluster severity is the highest severity reported, so a later `LOW` report never
  downgrades a `CRITICAL` cluster
- confidence grows by `LEAK_CLUSTER_CONFIDENCE_STEP` per corroborating report, starting from
  `LEAK_CLUSTER_CONFIDENCE_BASE`
- the radius widens with the observed spread and is capped at
  `LEAK_CLUSTER_MAX_RADIUS_METERS`
- report confidence is clamped to the lower of the reporter's role ceiling and the severity
  ceiling, so a citizen cannot claim full confidence for a low severity report
- a cluster moves `OPEN` to `TRIAGED` to `INVESTIGATING` to `RESOLVED`, or straight to
  `REJECTED`. Terminal clusters are immutable and drop out of the public map, and resolving
  one closes its reports in the same transaction

Work orders dispatch the repair. They move `OPEN` to `ASSIGNED` to `ACKNOWLEDGED` to
`IN_PROGRESS` to `COMPLETED`, with `ON_HOLD` and `CANCELLED` as side exits. Only dispatchers
and admins create or edit them, an assignee must be an active field technician, standpipe
operator, or dispatcher, and completion requires a resolution note. Field technicians and
operators only see the work orders assigned to them, and every mutation is
optimistically locked with `expectedUpdatedAt`, so a concurrent edit returns `409` instead of
silently overwriting.

Clustering tunables live in `.env` and are validated at startup: `LEAK_CLUSTER_RADIUS_METERS`,
`LEAK_CLUSTER_MAX_RADIUS_METERS`, `LEAK_CLUSTER_CONFIDENCE_BASE`, and
`LEAK_CLUSTER_CONFIDENCE_STEP`.

Both modules write outbox events and audit entries.

## Outbox and notifications

Domain services append to `outbox_events` inside the same transaction as the write, so a
committed change always has its event. A poller then claims due rows with
`SELECT ... FOR UPDATE SKIP LOCKED`, marks them `PROCESSING`, and increments `attempts`:

- Success marks the row `PROCESSED` and stamps `processed_at`.
- Failure schedules a retry with exponential backoff (capped at 15 minutes) and records the
  error in `last_error`.
- After `OUTBOX_MAX_ATTEMPTS` the row becomes `FAILED` and is left for inspection.
- A row left in `PROCESSING` longer than `OUTBOX_LOCK_TIMEOUT_MS` is released back to
  `PENDING`, so a crashed process cannot strand work.
- An event type the notifier does not recognise is a no-op that still counts as processed.

The poller is a database-backed loop rather than a queue consumer, so it needs no extra
infrastructure and survives a Redis outage. Tunables live in `.env` and are validated at
startup: `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_MAX_ATTEMPTS`,
`OUTBOX_LOCK_TIMEOUT_MS`, `OUTBOX_RETRY_BASE_MS`, and `OUTBOX_POLLER_ENABLED`. Setting
`OUTBOX_POLLER_ENABLED=false` disables the timer, which is what the e2e suite does so it can
drive dispatch deterministically.

Recognised events and their audiences:

| Event                 | Recipients                            | Excluded     |
| --------------------- | ------------------------------------- | ------------ |
| `leak.reported`       | active dispatchers and admins         | the actor    |
| `leak.status_changed` | everyone who reported to the cluster  | none         |
| `work_order.created`  | creator and assignee                  | the actor    |
| `work_order.status_changed` | creator and assignee             | the actor    |

`GET /api/v1/notifications` returns the caller's inbox with optional `status` and
`unreadOnly` filters, `GET /api/v1/notifications/unread-count` returns a badge count, and
`PATCH /api/v1/notifications/:id/read` marks one as read. A notification belonging to
another user answers `404`, never `403`. `GET` and `PATCH /api/v1/notifications/preferences`
manage per-channel opt-in; only `IN_APP` is delivered today and other channels answer `400`
until a provider is configured.

Delivery is exactly once per event and recipient. The idempotency record and the notification
are written in one transaction keyed on `event:user:channel`, so a failure part-way through
releases the claim instead of consuming it, and replaying an event cannot duplicate an inbox
entry.

## Telemetry and pressure monitoring

Telemetry sensors are registered against a standpipe with a `SensorType`
(`PRESSURE`, `FLOW`, `COMBINED`, or `SIMULATOR`) and an optional unique `externalId`.
Readings are appended with `POST /api/v1/telemetry/readings` or
`POST /api/v1/telemetry/readings/batch` and are idempotent per sensor `externalId`, so a
gateway retry cannot duplicate a sample. Ingest also stamps the sensor's `lastSeenAt`
without rebuilding the row, which keeps the sensor's optimistic lock stable for
concurrent registry edits.

Reading `source` is restricted: `SENSOR`, `CSV_IMPORT`, and `SIMULATOR` ingest is
admin-only, while `MANUAL` is available to admins, dispatchers, and field technicians.
`GET /api/v1/telemetry/pressure-stats` summarises a window and flags a low-pressure
condition below `TELEMETRY_LOW_PRESSURE_BAR` (default `1.5`).

Aggregates are produced by `POST /api/v1/telemetry/aggregates/rebuild`, which groups
readings into fixed `windowMinutes` buckets and upserts on `(sensor_id, window_start,
window_end)`, so a rebuild is idempotent and a re-run overwrites rather than duplicates
buckets.

## Pipeline and valve maintenance

Pipelines are registered per kebele with a GeoJSON `LineString` path, material, optional
diameter, and installation date. Valves are registered with a unique upper-cased `code`
and a GeoJSON `Point` location, and start `CLOSED`.

`POST /api/v1/maintenance/valves/:id/state` drives the position lifecycle `CLOSED` to
`OPEN` and back. Requesting the position a valve already holds is a `409`, and each
accepted transition is transactional (`SELECT ... FOR UPDATE`), records `lastChangedAt`
and `lastChangedById`, and audits `valve.opened` or `valve.closed`. Registry writes are
limited to admins and dispatchers, while valve operation is also open to field
technicians. Both registries support `expectedUpdatedAt`, so a concurrent edit returns
`409` instead of overwriting.

## SMS and USSD

SMS is delivered through a provider chosen by `SMS_PROVIDER`. `log` writes the message to the
application log and is the default, while `http` posts to `SMS_API_URL` with
`Authorization: Bearer $SMS_API_KEY`. An `http` configuration missing either value falls back
to `log` with a warning rather than dropping the message.

`identity.otp.requested` is dispatched to SMS. The code is decrypted from the challenge only
at send time and is written to the provider alone, so the stored notification records that a
code went out without persisting the secret. Delivery reuses the notification idempotency key
`event:user:SMS`: a replayed event cannot send a second message, and a failed send releases
the claim and marks the notification `FAILED` so the outbox retry can try again.

`POST /api/v1/ussd/callback` is the provider facing USSD entry point. It is public but every
request must carry `x-ussd-timestamp` and `x-ussd-signature`, where the signature is
`HMAC-SHA256(USSD_CALLBACK_SECRET, "<timestamp>.<raw body>")`. Verification is timing safe,
the timestamp must be within five minutes, and a payload edited in flight no longer matches.

A session is keyed by `sessionKey` and expires after five minutes. Selecting an option moves
the stored `menu_path`, `0` ends the session, and `*` returns to the main menu. Menu state is
pure and unit tested in `ussd/ussd-session.ts`; the service only supplies data. A number with
no active account is offered registration, while a registered caller sees the water points and
ratings for their kebele. An expired or foreign session restarts at the main menu rather than
leaking the previous caller's state. `GET /api/v1/ussd/sessions` lists sessions for admins and
dispatchers.

## Tests

```bash
npm run test        # unit tests
npm run test:cov    # unit tests with coverage
npm run test:e2e    # end-to-end tests against real infrastructure
```

The e2e suite is not mocked: it starts the real application against a real PostgreSQL and
Redis, and it signs in with the seeded admin. It therefore needs the local infrastructure
running, migrations applied, and the seed loaded:

```bash
npm run infra:up && npm run db:deploy && npm run db:seed && npm run test:e2e
```

`npm run check` is the full gate used in review: formatting, lint, typecheck, unit tests, and
build. Run it before opening a pull request.

## Conventions

- Strict TypeScript; no implicit `any`. ESLint rejects unsafe assignments and member access.
- DTOs are validated with `class-validator` and documented with `@nestjs/swagger` decorators,
  and property types are annotated explicitly so Swagger can infer schemas.
- ESM throughout: relative imports carry the `.js` suffix.
- Raw SQL is used deliberately for spatial and aggregate queries; parameters are always
  passed through Prisma tagged templates, never string concatenation.
- Multi-table writes run in a single transaction and publish an outbox event for downstream
  workers.
- Time is stored in UTC and presented in `APP_TIMEZONE` (default `Africa/Addis_Ababa`).

## License

MIT
