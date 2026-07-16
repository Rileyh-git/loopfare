# Architecture

Loopfare is a TypeScript monorepo that turns ordinary HTTP origins into x402-paid endpoints. One API process also serves the public website. A separate CLI manages seller resources and lets buyer agents pay for endpoints.

## System context

```text
                           management calls
                    +-----------------------------+
                    |                             v
Seller ----------> CLI or HTTP API ----------> Loopfare API
  |                                               |
  | receiving address                            | route config / events
  |                                               v
  +------------------------------------------> SQLite

Buyer agent ------ unpaid HTTP request ------> paid proxy route
     ^                                           |      |
     | 402 payment requirements                  |      +--> seller origin
     |                                           |
     +---- signed retry / response ---------------+-----> x402 facilitator
                                                           |
                                                           v
                                                    Base / Base Sepolia
```

The server is non-custodial: a project's `pay_to` address is placed in the payment requirement, and buyer signing remains in the buyer CLI or another x402 client.

## Repository map

```text
loopfare/
├── packages/
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts             process lifecycle and HTTP listener
│   │   │   ├── app.ts               routes, middleware, proxy, public API
│   │   │   ├── config.ts            environment loading and validation
│   │   │   ├── db.ts                SQLite schema, migrations, queries
│   │   │   ├── origin-security.ts   URL, DNS, address, connection controls
│   │   │   ├── x402.ts              x402 resource server and gates
│   │   │   └── site.ts              generated marketing HTML and assets
│   │   └── test/app.test.ts          API/security integration tests
│   └── cli/
│       └── src/
│           ├── index.ts              commands and buyer payment policy
│           ├── api.ts                seller/budget API client
│           ├── config.ts             local secrets and spend state
│           └── output.ts             human/JSON output
├── docs/                              public manuals and runbooks
├── nixpacks.toml                      Railway build phases
├── railway.toml                       runtime and health configuration
└── package.json                       npm workspace orchestration
```

Both workspaces use native ESM. TypeScript imports include `.js` suffixes so compiled Node.js output resolves correctly.

## Runtime components

### Configuration

`config.ts` loads the first available `.env` candidate and validates `process.env` with Zod during module initialization. It normalizes the public URL, network CAIP-2 identifier, CORS origins, numeric bounds, EVM address, and dollar price.

Startup fails before listening when configuration is invalid. Additional invariants prevent development payment mode in production and prevent Base mainnet from using the public x402.org testnet facilitator. The database directory is created after validation.

Because configuration is import-time immutable, changes require a process restart.

### HTTP application

`app.ts` creates a Hono application with these middleware layers:

1. Security headers and browser policy.
2. Request ID, response time, and structured request logging.
3. Exact-origin CORS on `/v1/*`.
4. Body limit and in-memory rate limit on `/v1/*`.
5. Body limit and a separate in-memory rate limit on `/p/*`.
6. Route-specific authentication, validation, payment, and proxy logic.
7. Stable JSON not-found and error handling.

Errors from Zod become 400 responses, HTTP exceptions retain their status, malformed JSON becomes 400, and unexpected production errors return a request ID without a stack trace.

### SQLite repository

`db.ts` opens one better-sqlite3 connection at module initialization and configures:

- WAL journal mode;
- foreign keys;
- a five-second busy timeout;
- `synchronous=NORMAL`.

The schema is created idempotently. Small forward-only migrations add columns when absent and migrate legacy plaintext API keys to digests. All database calls are synchronous inside the Node process. Budget increments use a SQLite transaction and conditional update.

This design is simple and provides strong single-process consistency, but it is intentionally a one-replica architecture. The database is also the application's startup/readiness dependency.

### x402 resource server

`x402.ts` lazily constructs one `HTTPFacilitatorClient` and `x402ResourceServer`, registers the exact EVM scheme for the configured CAIP-2 network, then creates route-specific Hono payment middleware.

There are two gates:

- a fixed optional demo at `GET /demo/v1/fortune`;
- dynamic middleware constructed from a matched route's method, path, price, description, and project receiving address.

The resource server is cached for the process lifetime. Changing facilitator or network configuration requires restart.

### Origin security and HTTP dispatcher

`origin-security.ts` normalizes seller origins, blocks unsafe hostnames and addresses, and resolves DNS before route storage/use. The paid proxy uses an Undici `Agent` with a custom lookup callback that validates the actual DNS answer selected at connection time.

The agent is shared for connection pooling and closed during graceful shutdown.

### CLI

The CLI uses Commander and supports both human output and top-level `--json` output. It has two roles:

- **Seller control plane:** signup, key storage/rotation, projects, routes, and earnings.
- **Buyer data plane:** local wallet, budget, and automatic x402-paid fetch.

Local state lives at `~/.loopfare/config.json`. Environment variables can override API URL, API key, and private key. The payment client registers the exact EVM scheme only for Base and Base Sepolia and accepts only each network's official USDC contract.

## Data model

```text
accounts 1 ───────< projects 1 ───────< routes
                        |
                        +─────────────< payments

buyer_budgets     (keyed independently by wallet address)
```

### `accounts`

- globally unique lowercase email;
- API key digest and display prefix;
- legacy compatibility column containing a non-recoverable digest marker;
- creation timestamp.

### `projects`

- owning account foreign key with cascade delete;
- globally unique lowercase slug;
- display name and EVM receiving address;
- creation timestamp.

### `routes`

- project foreign key with cascade delete;
- path pattern and allowed method list;
- normalized origin base URL;
- dollar price, description, enabled flag, and creation timestamp.

There is no uniqueness constraint preventing overlapping route patterns. Resolution order therefore matters.

### `payments`

- optional route and project identifiers;
- public request method/path;
- price and application status;
- optional transaction hash and buyer hint;
- creation timestamp.

Demo events may have no project. Foreign keys are not declared on this table, so deleting a project does not delete its historical payment events, although ordinary account-scoped queries no longer join those orphaned rows.

### `buyer_budgets`

- unique lowercase wallet address;
- budget-token digest;
- daily limit, current UTC-day spend, day marker, and update timestamp.

The day resets lazily when the record is read.

## Seller management flow

```text
POST /v1/auth/signup
  -> validate email
  -> reject existing email
  -> generate lf_ key
  -> store digest
  -> return key once

POST /v1/projects (Bearer key)
  -> authenticate digest
  -> validate name/slug/pay-to
  -> insert owned project

POST /v1/projects/:id/routes (Bearer key)
  -> authenticate and authorize project
  -> validate path/method/price/origin shape
  -> resolve and reject unsafe origin
  -> normalize and insert route
```

Keys are not recoverable. Rotation generates a replacement and atomically stops lookup by the old digest.

## Route matching

For `METHOD /p/:projectSlug/some/path`:

1. Look up the project by lowercase slug.
2. Load its routes in descending `created_at` order.
3. Ignore disabled routes.
4. Require exact method membership or `*`.
5. Evaluate the normalized path pattern.
6. Use the first match.

Patterns support:

- exact: `/v1/weather`;
- parameter segment: `/v1/users/:id`;
- trailing subtree: `/v1/*`;
- a per-segment `*` for a single segment in non-trailing patterns.

Query strings do not participate in matching. Newly created overlapping routes take precedence because routes are read newest first. Operators should avoid ambiguous patterns and test route resolution after updates.

## Paid proxy request flow

```text
Buyer                 Loopfare                   Facilitator          Origin
  |  request             |                           |                   |
  |--------------------->| route + origin safety     |                   |
  |<-- 402 requirements--|                           |                   |
  |  signed retry        |                           |                   |
  |--------------------->| verify------------------->|                   |
  |                      |<-----------verified-------|                   |
  |                      | reserve optional budget                       |
  |                      | strip sensitive headers                       |
  |                      |---------------------------------------------->|
  |                      |<----------------------------------------------|
  |                      | settle------------------->|                   |
  |                      |<-- PAYMENT-RESPONSE-------|                   |
  |                      | record event                                  |
  |<---- streamed response, filtered headers ----------------------------|
```

Before verification, Loopfare checks an optional buyer budget only when both wallet and budget-token headers are present. After the signed payment is verified, it atomically reserves budget before calling the origin. A failed origin or absent settlement releases that reservation. The payment middleware settles successful origin handling, adds `PAYMENT-RESPONSE`, and only then does Loopfare record the event.

Before forwarding, the proxy revalidates DNS and uses the safe connection dispatcher. It preserves the incoming query, combines the origin base path with the routed path, strips sensitive and hop-by-hop request headers, and adds correlation headers. Redirects are returned rather than followed. The response body is streamed.

## Development payment flow

When `LOOPFARE_DEV_MODE=true`, a local caller may send `LOOPFARE-DEV-PAYMENT: ok` (or the expected price). The server bypasses the facilitator, calls the origin, and records a `dev_settled` event after a successful origin response. Production configuration rejects this mode at startup.

Tests use development payment mode with a temporary database so no network payment is required.

## Buyer CLI payment flow

```text
loopfare call URL
  -> validate URL and HTTP method
  -> load local wallet and optional headers
  -> require budget unless --no-budget was explicit
  -> send unpaid request
  -> parse x402 requirements
  -> keep official USDC on Base/Base Sepolia only
  -> select least expensive affordable requirement
  -> sign and retry
  -> process settlement response
  -> add settled amount to local UTC-day counter
```

The CLI also sends wallet and budget-token headers when configured, allowing the Loopfare server to apply its own safety rail. Local JSON updates are not coordinated between simultaneous CLI processes.

## Security header flow

The application globally adds CSP, framing, MIME, referrer, cross-origin resource, and permissions controls. The marketing site is a generated HTML string with inline style/script, which requires the current CSP's inline allowances.

Proxy responses inherit global Loopfare headers after being constructed from upstream response headers. Upstream cookie headers are stripped because multiple seller origins share one public Loopfare domain; see [SECURITY_MODEL.md](./SECURITY_MODEL.md).

## Deployment lifecycle

```text
source + package-lock
        |
        v
Nixpacks: Node 22 + npm ci
        |
        v
TypeScript API build
        |
        v
node packages/api/dist/index.js
        |
        +--> configuration validation
        +--> SQLite open + additive migration
        +--> bootstrap account when configured
        +--> listen / readiness
```

Railway checks `/health/ready`, restarts on failure up to the configured maximum, and mounts the persistent volume at runtime. Graceful shutdown waits for the HTTP server to close, closes the Undici agent and SQLite connection, and has a ten-second forced-exit guard.

## Failure behavior

| Dependency or condition | User-visible behavior |
| --- | --- |
| Invalid configuration | Process refuses to start |
| SQLite unavailable at startup | Import/start failure; deployment does not become ready |
| SQLite fails after start | Readiness 503 or request 500, depending on operation |
| Unsafe/unresolvable route origin | Creation/update 400; use-time 502 with `blocked_origin` log |
| Facilitator rejects/no payment | 402 or middleware error; origin is not called |
| Facilitator unavailable | Paid path fails closed; no intentional payment bypass |
| Origin timeout/network failure | Request fails through global error handling, usually 500 today rather than a dedicated gateway timeout |
| Origin returns error | Upstream status/body are returned; the current middleware flow does not record a settlement and releases reserved budget |
| Budget exceeded | 402 before payment when compatible headers are present |
| Budget token invalid | 403 before payment |
| Process receives SIGTERM | Stops server, closes resources, exits 0 if completed within guard |

## Design decisions

### Single service for website and API

This minimizes beta deployment complexity and ensures one canonical domain. It couples website availability and proxy/API availability and requires inline/generated frontend code to share server security policy.

### SQLite and synchronous queries

SQLite gives atomic local transactions, a small operating surface, and straightforward backups. Synchronous queries are acceptable at beta scale because operations are small, but long queries block the Node event loop. The one-file store prevents ordinary horizontal scaling.

### Direct-to-seller settlement

Project-specific receiving addresses keep Loopfare non-custodial and reduce treasury risk. The tradeoff is limited platform-level refund or revenue control and a larger reconciliation surface across many addresses.

### Dynamic payment middleware

Constructing the x402 route requirement after database route matching allows arbitrary seller paths and prices. It places database correctness and route resolution directly in the payment authorization boundary.

### Public-origin-only proxy

Blocking private destinations is the safe multi-tenant default. Local development can intentionally allow private origins, but production startup currently allows that flag if explicitly set; deployment policy must enforce it as false.

## Scaling and evolution

Move beyond this architecture when any of the following is true:

- more than one replica or region is required;
- database write latency or event-loop blocking becomes material;
- payment reconciliation and immutable audit history are contractual;
- background settlement/finality work is required;
- global rate limits or per-tenant quotas are required;
- backups need point-in-time recovery or cross-region replication.

A typical next architecture would use Postgres for tenant/configuration state, an append-only payment event table, a durable queue for reconciliation, shared edge or Redis rate limiting, object storage for exports, and a dedicated metrics/tracing pipeline. Make that migration explicit; do not put a SQLite file on shared network storage as a shortcut.

## Known architecture gaps

- No management audit log or operator console.
- No email verification, account recovery, roles, or organization model.
- No maintenance/read-only mode for consistent restore cutovers.
- No automated off-platform data export or retention job.
- No transaction/finality reconciliation loop.
- No shared proxy concurrency policy; limits remain process-local.
- No authenticated facilitator configuration for mainnet.
- No central metrics/traces and no shared rate limiter.
- No dedicated per-tenant process/network isolation for seller origins.

These gaps define the boundary of the current public beta and should drive the production roadmap.
