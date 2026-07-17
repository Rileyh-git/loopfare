# Loopfare API reference

This reference documents the public HTTP contract for Loopfare `0.2.3` as implemented in this repository. Loopfare combines a seller management API, a buyer budget API, an x402 v2 paid reverse proxy, public service metadata, and a paid demo.

## Base URL and versioning

Use the HTTPS origin shown by `GET /api` as the base URL:

```text
https://YOUR_LOOPFARE_HOST
```

Seller and buyer management endpoints are under `/v1`. The paid proxy and public utility endpoints are not under `/v1`.

| Property | Value |
| --- | --- |
| Loopfare application version | `0.2.3` |
| Management API version | `v1` |
| Payment protocol | x402 v2 |
| Payment scheme | `exact` on EVM |
| Supported configured networks | Base Sepolia, Base mainnet |
| Default network | Base Sepolia |
| Base Sepolia CAIP-2 ID | `eip155:84532` |
| Base mainnet CAIP-2 ID | `eip155:8453` |
| Price currency | USD-denominated USDC |

The active deployment network is returned by `GET /api` and `GET /health`. Never assume mainnet: verify `network` and `networkCaip2` before funding or signing.

## Conventions

### JSON and field names

Send JSON request bodies with:

```http
Content-Type: application/json
```

Management request fields use `camelCase`. Persistent seller resources are currently returned with database-shaped `snake_case` fields. Treat generated IDs as opaque strings.

Timestamps are UTC ISO 8601 strings, for example `2026-07-16T18:25:43.511Z`.

### Request tracing

Every response includes:

| Header | Meaning |
| --- | --- |
| `X-Request-Id` | The caller's `X-Request-Id`, truncated to 100 characters, or a server-generated UUID. Include this in support requests. |
| `X-Response-Time` | Application processing time in milliseconds, such as `18ms`. |

You may provide your own `X-Request-Id` on any request.

### Security response headers

Loopfare applies these headers to every route, including proxied responses:

| Header | Value or policy |
| --- | --- |
| `Content-Security-Policy` | Self-only default, base, connect, and form sources; no frames or objects; inline script/style allowed for the built-in website and docs; `data:` allowed for fonts and images |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `cross-origin` |
| `Origin-Agent-Cluster` | `?1` |
| `Permissions-Policy` | Camera, geolocation, microphone, and browser payment disabled |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Download-Options` | `noopen` |
| `X-Frame-Options` | `SAMEORIGIN` (the CSP `frame-ancestors 'none'` rule is stricter) |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `X-XSS-Protection` | `0`, disabling the obsolete browser auditor in favor of CSP |

### Seller authentication

Seller endpoints require the API key issued once by signup or key rotation:

```http
Authorization: Bearer lf_YOUR_API_KEY
```

Loopfare stores a SHA-256 digest, not the recoverable key. Rotating a key invalidates the previous key immediately.

Buyer budget tokens are separate secrets and do not authenticate seller endpoints.

### Buyer budget authentication

Budget endpoints accept a secret token through either of these forms:

```http
X-Loopfare-Budget-Token: lb_YOUR_TOKEN
```

```http
Authorization: Bearer lb_YOUR_TOKEN
```

The dedicated header takes precedence when both are present. Tokens must contain 24 to 200 characters. The first token used to create a budget claims that wallet's budget record; later updates require the same token.

### Limits

| Limit | Default behavior |
| --- | --- |
| All `/v1/*` requests | 300 requests per client IP per 60 seconds |
| `POST /v1/auth/signup` | An additional 5 requests per client IP per hour |
| `/v1/*` request body | 1 MiB by default; operator-configurable from 1 KiB to 10 MiB |
| Payment history page size | Default 50, minimum 1, maximum 100 |
| Upstream proxy timeout | 30 seconds by default; operator-configurable from 1 to 120 seconds |
| Upstream proxy response | 10 MiB by default; operator-configurable from 64 KiB to 100 MiB |

Rate-limited `/v1/*` responses expose:

| Header | Meaning |
| --- | --- |
| `RateLimit-Limit` | Requests permitted in the active window |
| `RateLimit-Remaining` | Remaining requests, never below `0` |
| `RateLimit-Reset` | Window reset as Unix epoch seconds |
| `Retry-After` | Seconds until reset; present on `429` only |

The limits are per running service instance and are not a distributed quota.

### CORS

CORS middleware applies only to `/v1/*`. The deployment allowlists configured origins and supports `GET`, `POST`, `PATCH`, `DELETE`, and `OPTIONS`. Allowed request headers are:

- `Authorization`
- `Content-Type`
- `Payment-Signature`
- `X-Loopfare-Budget-Token`
- `X-Loopfare-Wallet`

Browser code may read `Payment-Required`, `Payment-Response`, and `X-Request-Id`. Preflight results may be cached for 86,400 seconds. The paid proxy under `/p/*` does not currently add this management-API CORS policy.

### Error bodies

Loopfare-owned errors use JSON:

```json
{
  "error": "stable_machine_code",
  "message": "Human-readable explanation"
}
```

Errors raised by authorization, ownership, and parameter checks also include the request ID. Validation errors include a Zod `issues` array. Protocol errors produced by the x402 middleware have their own body and headers. See [Error reference](./ERROR_REFERENCE.md) for the exact cases.

## Resource schemas

### Account signup response

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque account ID |
| `email` | string | Normalized lowercase email |
| `apiKey` | string | One-time seller key; store immediately |
| `apiKeyPrefix` | string | First 10 characters, suitable for identification only |
| `createdAt` | ISO timestamp | Account creation time |
| `hint` | string | Key-storage reminder |

### Project

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque project ID |
| `account_id` | string | Owning account ID |
| `name` | string | Display name |
| `slug` | string | Lowercase globally unique paid-proxy slug |
| `pay_to` | string | EVM receiving address |
| `created_at` | ISO timestamp | Creation time |
| `proxyBase` | URL | Added by project API responses |

### Protected route

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque route ID |
| `project_id` | string | Parent project ID |
| `path_pattern` | string | Normalized route pattern |
| `methods` | string | Comma-separated uppercase methods |
| `origin_url` | URL string | Normalized upstream base URL |
| `price` | string | Normalized USD price, such as `$0.001` |
| `description` | string | x402 resource description |
| `enabled` | integer | `1` enabled, `0` disabled |
| `created_at` | ISO timestamp | Creation time |

### Payment event

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque event ID |
| `route_id` | string or null | Protected route, or `null` for the demo |
| `project_id` | string or null | Seller project, or `null` for the demo |
| `method` | string | HTTP method |
| `path` | string | Loopfare request path |
| `price` | string | Configured route price |
| `status` | string | Currently `settled` or `dev_settled` for recorded successful gates |
| `tx_hash` | string or null | Settlement transaction identifier decoded from `PAYMENT-RESPONSE`, when supplied by the facilitator |
| `buyer_hint` | string or null | Caller-supplied wallet hint, `dev-mode`, or `null`; not verified identity |
| `created_at` | ISO timestamp | Recorded time |

Payment events are application records, not an authoritative on-chain ledger. Reconcile financial reporting against the receiving wallet and facilitator.

### Buyer budget

| Field | Type | Notes |
| --- | --- | --- |
| `walletAddress` | string | Lowercase EVM address |
| `dailyLimitUsd` | number | Configured daily limit |
| `spentTodayUsd` | number | Spend recorded by compatible Loopfare calls |
| `remainingTodayUsd` | number | `max(0, limit - spent)` |
| `spentDay` | `YYYY-MM-DD` | UTC accounting day |
| `updatedAt` | ISO timestamp | Last mutation or day reset |

Budgets are cooperative application safety rails. They do not restrict the wallet on-chain, and calls that omit both budget headers do not use the server-side budget.

## Public metadata and health

### `GET /`

Returns the public product website as HTML.

- Authentication: none
- Success: `200 text/html`
- Cache: `public, max-age=300, stale-while-revalidate=3600`

### `GET /favicon.svg`

Returns the SVG favicon.

- Authentication: none
- Success: `200 image/svg+xml`
- Cache: `public, max-age=86400`

### `GET /favicon.ico`

Redirects permanently to the SVG favicon.

- Authentication: none
- Response: `301` with `Location: /favicon.svg`

### `GET /robots.txt`

Returns crawler instructions. `/v1/` is disallowed and the deployment's sitemap URL is advertised.

- Authentication: none
- Success: `200 text/plain`

### `GET /sitemap.xml`

Returns an XML sitemap containing the website root, documentation index, and every registered public documentation page.

- Authentication: none
- Success: `200 application/xml`

### `GET /api`

Returns machine-readable service discovery and route hints.

```bash
curl https://YOUR_LOOPFARE_HOST/api
```

```json
{
  "name": "loopfare",
  "version": "0.2.3",
  "tagline": "Make every API call pay its fare",
  "network": "base-sepolia",
  "networkCaip2": "eip155:84532",
  "protocol": "x402-v2",
  "publicUrl": "https://YOUR_LOOPFARE_HOST",
  "demoEnabled": false,
  "docs": {
    "website": "GET /",
    "health": "GET /health",
    "signup": "POST /v1/auth/signup",
    "projects": "GET|POST /v1/projects",
    "protect": "POST /v1/projects/:id/routes",
    "proxy": "ANY /p/:projectSlug/*",
    "demo": "GET /demo/v1/fortune",
    "agentSkill": "GET /skill.md"
  }
}
```

- Authentication: none
- Success: `200 application/json`

### `GET /health`

Returns an expanded health snapshot.

```json
{
  "ok": true,
  "service": "loopfare",
  "version": "0.2.3",
  "network": "base-sepolia",
  "demoEnabled": false,
  "timestamp": "2026-07-16T18:25:43.511Z"
}
```

`ok` reflects a live SQLite `SELECT 1`. This endpoint currently responds with HTTP `200` even if `ok` is false; use readiness for load-balancer decisions.

### `GET /health/live`

Process liveness check.

```json
{ "ok": true }
```

- Success: `200 application/json`

### `GET /health/ready`

Database readiness check.

```json
{ "ok": true }
```

- Ready: `200`
- Not ready: `503`

### `GET /skill.md`

Returns concise seller and buyer instructions for AI agents.

- Authentication: none
- Success: `200 text/markdown`

### `GET /docs`

Returns the public documentation index as HTML.

- Authentication: none
- Success: `200 text/html`
- Cache: `public, max-age=300, stale-while-revalidate=3600`

### `GET /docs/:slug`

Returns a registered public documentation page rendered as HTML. Current slugs are discoverable from the documentation index and sitemap; examples include `quickstart`, `seller-manual`, `buyer-manual`, `cli-reference`, `api-reference`, and `error-reference`.

- Authentication: none
- Success: `200 text/html`
- Cache: `public, max-age=300, stale-while-revalidate=3600`
- Missing slug: `404` JSON `{ "error": "doc_not_found", "message": "Documentation page not found" }`

### `GET /docs/:slug.md`

Returns the source Markdown for a registered public documentation page.

- Authentication: none
- Success: `200 text/markdown`
- Cache: `public, max-age=300, stale-while-revalidate=3600`
- Missing slug: `404 doc_not_found`

## Seller authentication

### `POST /v1/auth/signup`

Creates a seller account and returns its only recoverable copy of the API key.

- Authentication: none
- Additional rate limit: 5 requests per client IP per hour

Request:

```bash
curl -X POST https://YOUR_LOOPFARE_HOST/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"seller@example.com"}'
```

```json
{
  "email": "seller@example.com"
}
```

| Field | Validation |
| --- | --- |
| `email` | Required valid email, maximum 254 characters |

Success: `201`

```json
{
  "id": "ACCOUNT_ID",
  "email": "seller@example.com",
  "apiKey": "lf_ONE_TIME_SECRET",
  "apiKeyPrefix": "lf_ONE_TIM",
  "createdAt": "2026-07-16T18:25:43.511Z",
  "hint": "Store apiKey securely. It cannot be retrieved later."
}
```

Errors:

- `400 validation_error` or `invalid_json`
- `409 account_exists`
- `413 payload_too_large`
- `429 rate_limited`
- `503 signup_disabled`

Account existence is disclosed by this endpoint. There is no password-based API-key recovery; an operator must assist an account that has lost its key.

### `GET /v1/auth/me`

Returns the identity associated with the seller API key.

```bash
curl https://YOUR_LOOPFARE_HOST/v1/auth/me \
  -H 'Authorization: Bearer lf_YOUR_API_KEY'
```

Success: `200`

```json
{
  "accountId": "ACCOUNT_ID",
  "email": "seller@example.com"
}
```

Errors: `401 unauthorized` with message `Missing Bearer API key` or `Invalid API key`.

### `POST /v1/auth/rotate-key`

Replaces the authenticated account's API key. The previous key stops working immediately.

```bash
curl -X POST https://YOUR_LOOPFARE_HOST/v1/auth/rotate-key \
  -H 'Authorization: Bearer lf_CURRENT_API_KEY'
```

Success: `200`

```json
{
  "apiKey": "lf_NEW_ONE_TIME_SECRET",
  "apiKeyPrefix": "lf_NEW_ONE",
  "hint": "The previous API key stopped working immediately."
}
```

Errors: `401 unauthorized` for missing or invalid seller authentication.

## Projects

All project endpoints require seller authentication. A project defines a globally unique proxy slug and one receiving wallet. Deleting a project permanently deletes its route records through a database cascade; existing payment rows are not database foreign-key cascaded.

### `POST /v1/projects`

Creates a seller project.

Request:

```bash
curl -X POST https://YOUR_LOOPFARE_HOST/v1/projects \
  -H 'Authorization: Bearer lf_YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"Weather API",
    "slug":"weather-api",
    "payTo":"0x1111111111111111111111111111111111111111"
  }'
```

| Field | Validation |
| --- | --- |
| `name` | Required, trimmed, 1–80 characters |
| `slug` | Required, trimmed, 2–40 characters; letters, digits, and single internal hyphens; stored lowercase; globally unique |
| `payTo` | Required `0x`-prefixed 40-hex-character EVM address |

Success: `201`. The response is the [Project](#project) plus `proxyBase`.

```json
{
  "id": "PROJECT_ID",
  "account_id": "ACCOUNT_ID",
  "name": "Weather API",
  "slug": "weather-api",
  "pay_to": "0x1111111111111111111111111111111111111111",
  "created_at": "2026-07-16T18:25:43.511Z",
  "proxyBase": "https://YOUR_LOOPFARE_HOST/p/weather-api"
}
```

Errors: `400 validation_error` or `invalid_json`, `401 unauthorized`, `409 slug_taken`.

### `GET /v1/projects`

Lists projects owned by the authenticated account, newest first.

Success: `200`

```json
{
  "projects": [
    {
      "id": "PROJECT_ID",
      "account_id": "ACCOUNT_ID",
      "name": "Weather API",
      "slug": "weather-api",
      "pay_to": "0x1111111111111111111111111111111111111111",
      "created_at": "2026-07-16T18:25:43.511Z",
      "proxyBase": "https://YOUR_LOOPFARE_HOST/p/weather-api"
    }
  ]
}
```

There is no project pagination in `0.2.3`.

### `GET /v1/projects/:id`

Returns one owned project, its routes, and recorded earnings.

Success: `200`

```json
{
  "project": {
    "id": "PROJECT_ID",
    "account_id": "ACCOUNT_ID",
    "name": "Weather API",
    "slug": "weather-api",
    "pay_to": "0x1111111111111111111111111111111111111111",
    "created_at": "2026-07-16T18:25:43.511Z",
    "proxyBase": "https://YOUR_LOOPFARE_HOST/p/weather-api"
  },
  "routes": [],
  "earnings": {
    "count": 0,
    "volume_usd": 0
  }
}
```

`earnings.count` counts `settled` and `dev_settled` application events. `volume_usd` adds their configured prices and is rounded to six decimal places. Dev-mode events are included, so this is not a cash-settlement balance.

Errors: `401 unauthorized`; `404 not_found` with message `Project not found` for a missing project or a project owned by another account.

### `DELETE /v1/projects/:id`

Permanently deletes an owned project and its routes.

- Success: `204 No Content`
- Errors: `401 unauthorized`; `404 not_found` with message `Project not found`

## Protected routes

A route maps one or more HTTP methods and a path pattern to an upstream origin and an x402 price. All route-management endpoints require seller authentication and verify ownership through the parent project.

### Route validation and matching

Prices may be provided with or without `$`; responses always include it. Valid prices have up to six decimal places and range from `$0.000001` through `$10000`.

Methods are a comma-separated list containing any of:

```text
GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, *
```

The default is `GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS`. Duplicate methods are removed. `TRACE` and `CONNECT` cannot be configured.

Path patterns are normalized to begin with `/` and lose a trailing slash unless the pattern is `/`. They cannot contain a query string or fragment. Supported matching forms include:

| Pattern | Matches |
| --- | --- |
| `/v1/weather` | Exact normalized path |
| `/v1/:city` | Exactly one arbitrary segment |
| `/v1/*` | `/v1`, `/v1/`, and every descendant path |
| `/v1/*/detail` | `*` acts as one arbitrary segment in this non-trailing form |

Only enabled routes are considered. Matching checks routes newest first, so the newest matching route wins when patterns overlap. The URL query is not considered during route matching but is preserved when forwarding.

Origin URLs must use HTTP or HTTPS, may include a base path, and may not include credentials, a query, or a fragment. In the production-safe default, the hostname must resolve only to public IP addresses. Loopback, private, link-local, metadata, multicast, documentation, reserved, `.local`, `.internal`, `.localhost`, and `.home.arpa` destinations are blocked. DNS is checked both before the payment gate and at socket connection time.

### `POST /v1/projects/:id/routes`

Creates a protected route.

Request:

```bash
curl -X POST https://YOUR_LOOPFARE_HOST/v1/projects/PROJECT_ID/routes \
  -H 'Authorization: Bearer lf_YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "pathPattern":"/v1/*",
    "originUrl":"https://api.example.com/internal-api",
    "price":"$0.001",
    "description":"Current weather observation",
    "methods":"GET,POST"
  }'
```

| Field | Validation |
| --- | --- |
| `pathPattern` | Required string, 1–500 characters before normalization |
| `originUrl` | Required URL, maximum 2,048 characters, subject to origin safety policy |
| `price` | Required valid price string, maximum 32 characters |
| `description` | Optional trimmed string, maximum 500 characters; default `Protected by Loopfare` |
| `methods` | Optional valid comma-separated method string, maximum 200 characters |

Success: `201`

```json
{
  "route": {
    "id": "ROUTE_ID",
    "project_id": "PROJECT_ID",
    "path_pattern": "/v1/*",
    "methods": "GET,POST",
    "origin_url": "https://api.example.com/internal-api",
    "price": "$0.001",
    "description": "Current weather observation",
    "enabled": 1,
    "created_at": "2026-07-16T18:25:43.511Z"
  },
  "publicUrl": "https://YOUR_LOOPFARE_HOST/p/weather-api/v1/",
  "example": "https://YOUR_LOOPFARE_HOST/p/weather-api/..."
}
```

`publicUrl` is a display hint created by removing a final `*`; use `example` and the actual path pattern to construct calls.

Errors: `400` validation, JSON, or `bad_request` origin-safety error; `401 unauthorized`; `404 not_found` with message `Project not found`.

### `GET /v1/projects/:id/routes`

Lists all routes for an owned project, newest first.

Success: `200`

```json
{ "routes": [] }
```

There is no route pagination in `0.2.3`.

### `PATCH /v1/projects/:id/routes/:routeId`

Updates one or more route fields. Omitted fields are unchanged.

```bash
curl -X PATCH https://YOUR_LOOPFARE_HOST/v1/projects/PROJECT_ID/routes/ROUTE_ID \
  -H 'Authorization: Bearer lf_YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"price":"$0.0025","enabled":false}'
```

Accepted fields are `pathPattern`, `originUrl`, `price`, `description`, `methods`, and boolean `enabled`, with the same validation as route creation. At least one field is required. A changed origin is safety-checked before it is saved.

Success: `200`

```json
{
  "route": {
    "id": "ROUTE_ID",
    "project_id": "PROJECT_ID",
    "path_pattern": "/v1/*",
    "methods": "GET,POST",
    "origin_url": "https://api.example.com/internal-api",
    "price": "$0.0025",
    "description": "Current weather observation",
    "enabled": 0,
    "created_at": "2026-07-16T18:25:43.511Z"
  }
}
```

Errors: `400` validation, JSON, or `bad_request` origin-safety error; `401 unauthorized`; `404 not_found` with message `Project not found` or `Route not found`.

### `DELETE /v1/projects/:id/routes/:routeId`

Permanently deletes a route from an owned project.

- Success: `204 No Content`
- Errors: `401 unauthorized`; `404 not_found` with message `Project not found` or `Route not found`

## Payments and earnings

These endpoints require seller authentication. They return application events newest first; there is no cursor, date filter, or transaction-hash filter in `0.2.3`.

### `GET /v1/projects/:id/payments`

Returns payment events and aggregate earnings for one owned project.

Query parameters:

| Parameter | Default | Validation |
| --- | --- | --- |
| `limit` | `50` | Integer from 1 to 100 |

```bash
curl 'https://YOUR_LOOPFARE_HOST/v1/projects/PROJECT_ID/payments?limit=25' \
  -H 'Authorization: Bearer lf_YOUR_API_KEY'
```

Success: `200`

```json
{
  "payments": [
    {
      "id": "PAYMENT_EVENT_ID",
      "route_id": "ROUTE_ID",
      "project_id": "PROJECT_ID",
      "method": "GET",
      "path": "/p/weather-api/v1/current",
      "price": "$0.001",
      "status": "settled",
      "tx_hash": null,
      "buyer_hint": "0x2222222222222222222222222222222222222222",
      "created_at": "2026-07-16T18:25:43.511Z"
    }
  ],
  "earnings": {
    "count": 1,
    "volume_usd": 0.001
  }
}
```

Errors: `400 bad_request` with message `limit must be an integer from 1 to 100`; `401 unauthorized`; `404 not_found` with message `Project not found`.

### `GET /v1/payments`

Returns events for every project owned by the authenticated seller.

Query parameters: the same `limit` rule as the project endpoint.

Success: `200`

```json
{ "payments": [] }
```

The result excludes the paid demo and every other seller's projects.

## Buyer budgets

Buyer budgets use their own token rather than seller authentication. The Loopfare CLI generates a random `lb_...` token and stores it locally.

### `POST /v1/buyer/budget`

Creates or updates the daily budget for a wallet.

```bash
curl -X POST https://YOUR_LOOPFARE_HOST/v1/buyer/budget \
  -H 'Content-Type: application/json' \
  -H 'X-Loopfare-Budget-Token: lb_YOUR_SECRET_TOKEN' \
  -d '{
    "walletAddress":"0x2222222222222222222222222222222222222222",
    "dailyLimitUsd":5
  }'
```

| Field | Validation |
| --- | --- |
| `walletAddress` | Required `0x`-prefixed 40-hex-character EVM address |
| `dailyLimitUsd` | Required JSON number, greater than `0`, at most `1000000` |

Success: `200`

```json
{
  "budget": {
    "walletAddress": "0x2222222222222222222222222222222222222222",
    "dailyLimitUsd": 5,
    "spentTodayUsd": 0,
    "remainingTodayUsd": 5,
    "spentDay": "2026-07-16",
    "updatedAt": "2026-07-16T18:25:43.511Z"
  }
}
```

Updating the limit does not reset same-day spend. The spend counter resets lazily when the budget is read or checked on a later UTC date.

Errors: `400 validation_error` or `invalid_json`; `401 unauthorized` with message `Missing or invalid budget token`; `403 forbidden` with message `Invalid budget token` when another token already owns the wallet record.

### `GET /v1/buyer/budget/:address`

Returns the budget for a wallet when the matching secret token is supplied.

```bash
curl https://YOUR_LOOPFARE_HOST/v1/buyer/budget/0x2222222222222222222222222222222222222222 \
  -H 'X-Loopfare-Budget-Token: lb_YOUR_SECRET_TOKEN'
```

Success: `200` with `{ "budget": BuyerBudget }`.

Errors: `401 unauthorized` with message `Missing or invalid budget token`; `403 forbidden` with message `Invalid budget token` for a missing wallet record, a wrong address, or a wrong token.

### Applying a budget to a paid proxy call

Send both headers on the initial request and x402 retry:

```http
X-Loopfare-Wallet: 0x2222222222222222222222222222222222222222
X-Loopfare-Budget-Token: lb_YOUR_SECRET_TOKEN
```

Behavior:

1. If a budget token is present without `X-Loopfare-Wallet`, Loopfare returns `400 wallet_required`.
2. With both headers, Loopfare validates the token and checks whether `spent + route price` exceeds the daily limit before it asks for or accepts payment.
3. For an authorized dev payment or verified x402 retry, Loopfare atomically reserves the route's configured USD price before it calls the origin. Concurrent requests cannot reserve past the limit.
4. Loopfare refunds that reservation when the origin fails, returns status `>=400`, or real settlement does not complete.
5. Calls without both headers bypass this server-side safety rail.

The wallet header is a budget lookup and payment-history hint. Loopfare does not prove that it is the signer address, so this remains a cooperative client safety rail rather than an on-chain wallet policy.

## Paid demo

### `GET /demo/v1/fortune`

Returns a randomly selected fortune after the payment gate.

Success body after payment: `200`

```json
{
  "fortune": "A 402 is just a handshake in disguise.",
  "charged": "$0.001",
  "network": "base-sepolia",
  "product": "loopfare"
}
```

The configured demo price and receiving wallet are deployment-specific.

Possible initial responses:

- `402` with an x402 v2 `PAYMENT-REQUIRED` header when the demo is configured for real payments.
- `503 demo_not_configured` when the receiving wallet is the disabled all-zero address and dev mode is off.
- In local dev mode without a payment header, `402 payment_required` JSON containing the price, network, CAIP-2 network, receiving address, and dev instructions.

Production refuses to start with dev mode enabled. In an explicitly configured local development environment, any of these values authorizes a simulated payment:

```http
LOOPFARE-DEV-PAYMENT: ok
LOOPFARE-DEV-PAYMENT: 1
LOOPFARE-DEV-PAYMENT: true
LOOPFARE-DEV-PAYMENT: $0.001
LOOPFARE-DEV-PAYMENT: 0.001
```

Never send the development header to a production service.

## Paid reverse proxy

### `ANY /p/:projectSlug`

### `ANY /p/:projectSlug/*`

Calls a seller route through an x402 gate. No Loopfare seller account or API key is required for the buyer.

Example unpaid request:

```bash
curl -i 'https://YOUR_LOOPFARE_HOST/p/weather-api/v1/current?city=Toronto'
```

Loopfare extracts `/v1/current` as the route-matching path. It finds the newest enabled route for `weather-api` that matches the method and path, and checks the configured origin before requesting payment.

### x402 v2 exchange

The normal exchange is:

1. The buyer sends the intended HTTP request without a payment signature.
2. Loopfare returns HTTP `402` and a base64-encoded `PAYMENT-REQUIRED` header. The decoded declaration includes x402 version, the resource, and an `accepts` entry with the `exact` scheme, atomic USDC amount, CAIP-2 network, asset address, seller `payTo`, and timeout metadata.
3. The buyer selects a supported requirement, signs the payment payload, and repeats the same request with `PAYMENT-SIGNATURE`.
4. Loopfare asks its facilitator to verify the signature, invokes the seller origin, and cancels settlement when the origin returns an error (`>=400`).
5. After a successful origin response, the facilitator settles the payment. Loopfare returns that origin response with the base64-encoded `PAYMENT-RESPONSE` settlement result and records a payment event.

Header names are case-insensitive:

| Header | Direction | Meaning |
| --- | --- | --- |
| `PAYMENT-REQUIRED` | Loopfare → buyer | Base64-encoded x402 v2 payment declaration |
| `PAYMENT-SIGNATURE` | Buyer → Loopfare | Base64-encoded signed payment payload |
| `PAYMENT-RESPONSE` | Loopfare → buyer | Base64-encoded settlement response |

The underlying x402 middleware also recognizes legacy `X-PAYMENT` input, but new integrations should use the v2 headers. Treat all encoded protocol objects as opaque unless using an x402 library.

For clients that send both a Mozilla user agent and `Accept: text/html`, the x402 middleware may return an HTML paywall. API clients should send `Accept: application/json`; their unpaid body may be `{}`, with the authoritative challenge in `PAYMENT-REQUIRED`.

The official Loopfare CLI and `@x402/fetch` handle challenge decoding, signing, retry, and response parsing:

```bash
loopfare call https://YOUR_LOOPFARE_HOST/p/weather-api/v1/current --json
```

### Proxy URL construction

Suppose a route uses:

```json
{
  "originUrl": "https://api.example.com/internal-api",
  "pathPattern": "/v1/*"
}
```

Then:

```text
GET /p/weather-api/v1/current?city=Toronto
```

is forwarded to:

```text
GET https://api.example.com/internal-api/v1/current?city=Toronto
```

The buyer's method, query string, and non-stripped request body are preserved. Paid proxy requests use the same configurable request-body cap as management requests. Upstream redirects are returned to the caller rather than followed by Loopfare. The deployment rejects upstream responses larger than its configured proxy response limit.

### Header forwarding

Loopfare removes these buyer request headers before contacting the origin:

- `Authorization`
- `Connection`
- `Content-Length`
- `Cookie`
- `Host`
- `Keep-Alive`
- `LOOPFARE-DEV-PAYMENT`
- `PAYMENT-SIGNATURE`
- `Proxy-Authenticate`
- `Proxy-Authorization`
- `TE`
- `Trailer`
- `Transfer-Encoding`
- `Upgrade`
- `X-Loopfare-Budget-Token`
- `X-Loopfare-Wallet`
- `X-PAYMENT`

Loopfare adds:

```http
X-Forwarded-By: loopfare
X-Loopfare-Request-Id: REQUEST_ID
```

This means the current proxy cannot pass a buyer's `Authorization` or `Cookie` through to an upstream API. Use another non-sensitive application header for origin-specific credentials only after assessing its exposure.

Loopfare removes these upstream response headers:

- `Connection`
- `Content-Encoding`
- `Content-Length`
- `Keep-Alive`
- `Proxy-Authenticate`
- `Set-Cookie`
- `Set-Cookie2`
- `Transfer-Encoding`
- `Upgrade`

It adds:

```http
X-Loopfare-Proxied: 1
X-Loopfare-Request-Id: REQUEST_ID
```

The upstream status, status text, remaining headers, and body are returned to the buyer. The x402 settlement hook clones and buffers the body before settlement, within `MAX_PROXY_RESPONSE_BYTES`; clients receive the protected body only after successful settlement.

### Proxy errors

| Status | Body or signal | Meaning |
| --- | --- | --- |
| `400` | `wallet_required` | Budget token sent without a wallet header |
| `402` | x402 `PAYMENT-REQUIRED` | Payment is required or the signature was rejected |
| `402` | `budget_exceeded` | Compatible-client budget would be exceeded |
| `403` | `invalid_budget_token` | Wallet/token pair is invalid |
| `404` | `route_not_found` | No project route matched method and path |
| `502` | `origin_unavailable` | The stored origin no longer passes DNS/address safety checks |
| `502` | facilitator-generated `{ "error": "..." }` | Facilitator initialization, verification, or settlement failed |
| `502` | `bad_gateway` | Origin connection failed or its response exceeded the configured maximum |
| `504` | `gateway_timeout` | Origin did not respond before the configured timeout |
| `500` | `internal_error` | Other unexpected proxy failure |

Once a request reaches the origin, its own status code is passed through. Payment requirements are determined by Loopfare, not the upstream API.

## General status codes

| Status | Meaning in Loopfare |
| --- | --- |
| `200` | Successful read, update, paid demo, or proxied origin response |
| `201` | Account, project, or route created |
| `204` | Project or route deleted; no body |
| `400` | Invalid JSON, schema, query parameter, origin, or budget-header combination |
| `401` | Missing or invalid seller API key or budget token syntax (`unauthorized`) |
| `402` | x402 payment required, rejected payment, or budget exceeded |
| `403` | Wrong buyer budget token (`forbidden`) |
| `404` | Unknown endpoint, unmatched paid route, or seller-owned resource not found |
| `409` | Existing seller account or project slug |
| `412` | x402 protocol prerequisite such as a required allowance, if returned by the payment scheme |
| `413` | `/v1/*` body exceeds the configured maximum |
| `429` | Per-instance rate limit exceeded |
| `500` | Unexpected application or proxy failure |
| `502` | Facilitator failure or unsafe/unavailable configured origin |
| `503` | Signup disabled, demo not configured, or database not ready |
| `504` | Seller origin timeout |

For operational diagnosis, retain the `X-Request-Id` header and see [Error reference](./ERROR_REFERENCE.md).
