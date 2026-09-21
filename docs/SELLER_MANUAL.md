# Loopfare seller manual

> The safety update requires origin credentials and verification outside dev mode, and supports only GET/HEAD paid routes. Follow the [guided setup and rotation instructions](HARDENING.md#seller-origin-setup-and-rotation) before testing a route. Project deletion now archives it; historical payments remain in the account ledger.

Loopfare puts an x402 payment gate in front of an existing HTTP API. A buyer calls a Loopfare URL, receives an HTTP `402 Payment Required` challenge, signs a USDC payment, and retries. After settlement, Loopfare forwards the request to the seller's origin.

This manual covers the current Loopfare 0.2 public beta. The beta runs on **Base Sepolia** (`eip155:84532`) and uses test USDC. Do not treat testnet earnings as real revenue. Mainnet is intentionally disabled until the production gates in [PRODUCTION.md](./PRODUCTION.md) are complete.

## What you create

Loopfare has four seller-side objects:

- **Account** — identified by an email and authenticated with one `lf_...` API key.
- **Project** — a named product with a public slug and a receiving EVM address.
- **Protected route** — a path, HTTP-method allowlist, upstream origin, and per-request price.
- **Payment event** — Loopfare's record that a protected request settled or used local development payment mode.

If the Loopfare service is available at `https://loopfare.example` and a project has the slug `weather`, buyers call:

```text
https://loopfare.example/p/weather/v1/forecast?city=Toronto
```

Loopfare matches `/v1/forecast`, collects the configured payment, and forwards the path and query string to the route's origin.

## Before you begin

You need:

1. The public HTTPS URL of the Loopfare service.
2. Node.js 22 or later and the Loopfare CLI installed from npm.
3. A publicly reachable HTTP or HTTPS origin API.
4. An EVM address you control on the selected Base network. This is the project's `payTo` address; Loopfare never needs its private key.

Install the current public CLI:

```bash
npm install --global @loopfare/cli@latest
loopfare --version
```

If npm reports `EACCES`, do not use `sudo`; follow the [user-owned npm prefix instructions](./TROUBLESHOOTING.md#npm-global-install-fails-with-eacces), then retry the install.

Tell the CLI which Loopfare service to use:

```bash
loopfare set-api https://loopfare.example
```

You can instead set `LOOPFARE_API_URL` in the process environment. The environment value takes precedence over the URL saved in `~/.loopfare/config.json`.

## Complete onboarding workflow

### 1. Create the seller account

```bash
loopfare signup --email seller@example.com
```

The response contains the new `lf_...` API key and the CLI saves it to `~/.loopfare/config.json`. The key is only returned when the account is created; the service stores a hash and cannot display it later.

Protect the configuration file as you would a production password. The CLI creates `~/.loopfare` with mode `0700` and `config.json` with mode `0600`. For CI, use `LOOPFARE_API_KEY` instead of copying a personal configuration file.

Confirm authentication:

```bash
loopfare whoami
```

If an account already exists for the email, signup returns `409 account_exists`. Use the original key, or rotate it from an already authenticated CLI session. There is currently no email-based key recovery.

### 2. Create a project

```bash
loopfare projects create \
  --name "Weather API" \
  --slug weather \
  --pay-to 0x1111111111111111111111111111111111111111
```

Save the returned project `id`; route commands use the ID, while buyers see the slug.

Project rules:

- `name` is 1–80 characters.
- `slug` is 2–40 letters, numbers, or single hyphen-separated words. It is normalized to lowercase and must be globally unique on the service.
- `payTo` must be a 40-byte `0x`-prefixed EVM address.
- A project's receiving address and slug cannot currently be edited. Create a replacement project if either must change.

During the Base Sepolia beta, use an address you control on Base Sepolia. The same address format also exists on other EVM networks, so verify the selected network rather than relying on the address alone.

### 3. Protect an origin

The following route charges `$0.001` for `GET` requests below `/v1`:

```bash
loopfare protect \
  --project PROJECT_ID \
  --origin https://api.example.com \
  --path "/v1/*" \
  --price '$0.001' \
  --methods GET \
  --description "Weather forecast"
```

The response includes the route and a public URL. A request for `/p/weather/v1/forecast` is forwarded to `https://api.example.com/v1/forecast`.

Route rules:

- Prices are USD-denominated USDC amounts from `$0.000001` to `$10000`, with no more than six decimal places. The leading `$` is optional in CLI input.
- Omitting `--methods` allows `GET,HEAD`.
- Only read-only GET and HEAD are supported; paid writes remain disabled pending write-idempotency support.
- An exact pattern such as `/v1/forecast` matches only that path.
- A parameter segment such as `/v1/users/:id` matches one segment.
- A trailing wildcard such as `/v1/*` matches `/v1`, `/v1/`, and descendants.
- Query strings and fragments are not valid inside a path pattern. Incoming query strings are preserved when a request is proxied.
- A missing leading slash is added, and a trailing slash is removed except for `/`.
- If several enabled routes match, the most recently created matching route is selected. Prefer non-overlapping patterns so pricing does not depend on route order.

Production origin safety rules:

- Only `http://` and `https://` origins are accepted.
- The origin URL cannot contain credentials, a query string, or a fragment.
- Localhost, private networks, link-local destinations, cloud metadata hosts, multicast, and reserved addresses are blocked. DNS is checked when a route is created or changed and again for proxy requests.
- Upstream redirects are returned to the buyer and are not followed by Loopfare.
- The proxy removes `Authorization`, cookies, x402 payment headers, Loopfare budget/wallet headers, and hop-by-hop headers before contacting the origin. An origin that requires either cookies or the buyer's `Authorization` header is not currently supported.
- The incoming request body limit is configured by the operator and defaults to 1 MiB. The upstream response cap defaults to 10 MiB, and the upstream timeout defaults to 30 seconds.

`ALLOW_PRIVATE_ORIGINS=true` is for local development only. Production refuses unsafe network access by default.

### 4. Test the paid URL

Ask an x402-compatible buyer to call the public URL, or use the buyer workflow in [BUYER_MANUAL.md](./BUYER_MANUAL.md):

```bash
loopfare wallet create
loopfare budget set --daily 5
loopfare call https://loopfare.example/p/weather/v1/forecast
```

A raw client without payment support first receives HTTP 402 and a v2 `PAYMENT-REQUIRED` response header. An x402 client creates a `PAYMENT-SIGNATURE`, retries, and receives the origin response plus settlement information.

Local development can bypass crypto only when the server itself runs with `LOOPFARE_DEV_MODE=true`:

```bash
loopfare call http://localhost:4021/p/weather/v1/forecast --dev
```

Production refuses to start with dev payments enabled. A `dev_settled` event is test data, not an on-chain payment.

### 5. Inspect earnings

```bash
loopfare earnings --project PROJECT_ID
loopfare earnings --project PROJECT_ID --limit 100
```

The response includes recent payment events and an aggregate:

```json
{
  "payments": [],
  "earnings": {
    "count": 0,
    "volume_usd": 0
  }
}
```

The limit must be an integer from 1 to 100 and defaults to 50. Earnings sum events marked `settled` or `dev_settled`; during testing, separate dev events from real settlement when interpreting the total. The payment ledger is operational application data, not a tax statement or blockchain indexer.

## Day-to-day project operations

List projects:

```bash
loopfare projects list
```

Show a project with routes and aggregate earnings:

```bash
loopfare projects get PROJECT_ID
```

List protected routes:

```bash
loopfare routes list --project PROJECT_ID
```

Change one or more route fields:

```bash
loopfare routes update \
  --project PROJECT_ID \
  --route ROUTE_ID \
  --price '$0.002' \
  --methods GET,HEAD \
  --description "Forecast and refresh"
```

Temporarily stop a route from matching, then restore it:

```bash
loopfare routes update --project PROJECT_ID --route ROUTE_ID --disable
loopfare routes update --project PROJECT_ID --route ROUTE_ID --enable
```

Delete a route permanently:

```bash
loopfare routes delete --project PROJECT_ID --route ROUTE_ID --yes
```

Delete a project and all of its routes permanently:

```bash
loopfare projects delete PROJECT_ID --yes
```

The confirmation flags are mandatory and non-interactive. Deletion cannot be undone through the CLI. Historical payment rows may remain in operator storage, but they no longer appear as project earnings once their project is deleted.

## API-key operations

Use a key without running signup:

```bash
loopfare login --api-key lf_REDACTED --email seller@example.com
```

The optional email is only a local label. `login` does not validate the key; run `loopfare whoami` to test it.

Rotate a compromised or expiring key:

```bash
loopfare rotate-key
```

The old key stops working immediately and the replacement is saved locally. Update CI secrets before terminating the session in which you rotate the key.

For CI, provide secrets through the environment:

```bash
export LOOPFARE_API_URL=https://loopfare.example
export LOOPFARE_API_KEY=lf_REDACTED
loopfare --json projects list
```

Do not commit `~/.loopfare/config.json`, paste keys into issue reports, or place a real API key directly in a shared command history.

## Direct HTTP API

The CLI is a thin client over the seller API. This minimal workflow is useful from other languages:

```bash
LOOPFARE_URL=https://loopfare.example

curl -sS -X POST "$LOOPFARE_URL/v1/auth/signup" \
  -H 'Content-Type: application/json' \
  -d '{"email":"seller@example.com"}'

export LOOPFARE_API_KEY=lf_REDACTED

curl -sS -X POST "$LOOPFARE_URL/v1/projects" \
  -H "Authorization: Bearer $LOOPFARE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Weather API","slug":"weather","payTo":"0x1111111111111111111111111111111111111111"}'
```

Seller endpoints requiring `Authorization: Bearer lf_...` are:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/auth/me` | Current account |
| `POST` | `/v1/auth/rotate-key` | Replace API key |
| `GET`, `POST` | `/v1/projects` | List or create projects |
| `GET`, `DELETE` | `/v1/projects/:id` | Inspect or delete a project |
| `GET`, `POST` | `/v1/projects/:id/routes` | List or create routes |
| `PATCH`, `DELETE` | `/v1/projects/:id/routes/:routeId` | Update or delete a route |
| `GET` | `/v1/projects/:id/payments?limit=50` | Project payments and earnings |
| `GET` | `/v1/payments?limit=50` | Recent payments across the authenticated account |

Public service discovery is available at `GET /api`; health endpoints are `GET /health`, `/health/live`, and `/health/ready`.

## JSON automation

Place `--json` before the command for consistent global-option parsing:

```bash
PROJECT_ID="$(loopfare --json projects create \
  --name 'Weather API' \
  --slug weather \
  --pay-to 0x1111111111111111111111111111111111111111 \
  | jq -r '.id')"

loopfare --json protect \
  --project "$PROJECT_ID" \
  --origin https://api.example.com \
  --path '/v1/*' \
  --price '$0.001'
```

Successful JSON is printed to stdout. CLI/API failures with `--json` also print a JSON error object to stdout and exit nonzero:

```json
{
  "error": "API 401 /v1/projects",
  "body": {
    "message": "Invalid API key"
  }
}
```

Always check the exit status; do not infer success only because the output parses as JSON. See [CLI_REFERENCE.md](./CLI_REFERENCE.md) for every command and flag.

## Troubleshooting

### `API 401`

Run `loopfare config`, check the API URL, then run `loopfare whoami`. Verify `LOOPFARE_API_KEY` is not overriding the saved key. After key rotation, the previous key is invalid immediately.

### `account_exists`

The email already has an account. Use its original API key. Key rotation also requires a working current key; there is no self-service email recovery in 0.2.

### `slug_taken`

Project slugs are global. Pick another public slug.

### Origin rejected

Use a public `http` or `https` origin without embedded credentials, query parameters, or a fragment. Production does not proxy localhost, LAN addresses, internal DNS names, or cloud metadata endpoints.

### `route_not_found`

Confirm the project slug in the public URL, route status, HTTP method, and path pattern with `projects get` or `routes list`. The path being matched is everything after `/p/:projectSlug`.

### Buyer receives `402`

This is the normal first x402 response. The buyer must use an x402 v2 client, have compatible test USDC, and submit the payment signature. A raw browser navigation or ordinary `curl` request does not pay automatically.

### Origin receives no authentication

Loopfare intentionally strips buyer `Authorization` and `Cookie` headers. Use a public origin endpoint, a network-level trust boundary, or a separate future origin-authentication feature; do not put an origin secret in its URL.

### Earnings look higher than expected in development

`dev_settled` test calls count in the current aggregate. Inspect each payment's `status` and do not treat development events as real USDC.

### `429 Too Many Requests`

The service applies an API limit of 300 requests per minute per client identifier and a signup limit of five attempts per hour. Respect `Retry-After` and the `RateLimit-*` response headers.

## Beta limitations

- The supported public-beta network is Base Sepolia; no real-value mainnet launch is implied.
- The public CLI is distributed as `@loopfare/cli` on npm and still targets a Base Sepolia beta by default.
- There is no seller dashboard, email verification, email-based key recovery, project editing, refunds workflow, invoicing, or tax reporting.
- The proxy does not pass buyer cookies or authorization to the origin, follow origin redirects, or support private origins in production.
- SQLite deployment requires one application replica and a persistent-volume backup plan.
- Payment records are Loopfare application events; sellers should reconcile real-value settlements independently before any mainnet launch.

For buyer setup, continue with [BUYER_MANUAL.md](./BUYER_MANUAL.md). For deployment and mainnet gates, see [PRODUCTION.md](./PRODUCTION.md).
