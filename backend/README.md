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
| `reports`     | Citizen and operator flow and queue reports, plus the outbox       |
| `consensus`   | Bayesian tap consensus and queue trend snapshots                   |
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
