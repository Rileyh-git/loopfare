# Loopfare

**Make every API call pay its fare.**

Loopfare is an x402 v2 reverse proxy for Base. Sellers put a payment gate in front of an existing HTTP API; AI agents and other buyers pay per request in USDC without buyer accounts, subscriptions, or API keys.

The same service includes:

| Surface | Role |
| --- | --- |
| Marketing site | Product overview, protocol flow, quickstart, and live health |
| Seller API | Accounts, projects, protected routes, payments, and earnings |
| Paid proxy | Dynamic x402 gates in front of seller origins |
| CLI | Seller administration and budget-aware buyer payments |
| Agent skill | Machine-readable instructions at `/skill.md` |
| Documentation center | Hosted guides, manuals, API/CLI references, and raw Markdown at `/docs` |

## Architecture

```text
AI agent / x402 client
        │
        │ 1. normal HTTP request
        ▼
Loopfare paid proxy ── 2. HTTP 402 + PAYMENT-REQUIRED
        ▲
        │ 3. PAYMENT-SIGNATURE
        │
        ├── facilitator verifies and settles USDC on Base
        │
        └── 4. paid request ──► seller origin API
```

- Protocol: x402 v2
- Default network: Base Sepolia (`eip155:84532`)
- Default test facilitator: `https://x402.org/facilitator`
- Storage: SQLite in WAL mode on a persistent Railway volume
- Runtime: Node.js 22+ and Hono

## Local quickstart

```bash
git clone https://github.com/Rileyh-git/loopfare.git
cd loopfare
cp .env.example .env
npm ci
npm run dev
```

The website and API start at [http://localhost:4021](http://localhost:4021).

Run the CLI from this checkout in another terminal:

```bash
# Optional: make `loopfare` available globally while developing
npm run build -w @loopfare/cli
npm link -w @loopfare/cli

loopfare set-api http://localhost:4021
loopfare signup --email you@example.com --json
loopfare projects create \
  --name "Weather API" \
  --slug weather \
  --pay-to 0xYourReceivingAddress \
  --json
loopfare protect \
  --project PROJECT_ID \
  --origin https://httpbin.org \
  --path "/*" \
  --price "$0.001" \
  --json
```

Use local dev payment mode without crypto:

```bash
loopfare wallet create --json
loopfare budget set --daily 5 --json
loopfare call http://localhost:4021/demo/v1/fortune --dev --json
```

`ALLOW_PRIVATE_ORIGINS=true` is intended only for local development. It lets a project proxy a local test server.

## CLI

All commands accept the top-level `--json` flag for machine-readable output.

| Command | Description |
| --- | --- |
| `loopfare signup --email …` | Create a seller account and store the one-time API key |
| `loopfare rotate-key` | Replace the active seller API key |
| `loopfare projects create/list/get/delete` | Manage seller projects |
| `loopfare protect` | Add a paid route in front of an origin |
| `loopfare routes list/update/delete` | Operate protected routes |
| `loopfare earnings --project …` | Inspect payments and earnings |
| `loopfare wallet create/import/show` | Manage the local buyer wallet |
| `loopfare budget set/show` | Configure the token-protected daily limit |
| `loopfare call <url>` | Pay an x402 endpoint and return its response |

Real payments require a configured daily budget by default. `--no-budget` is an explicit escape hatch. The CLI currently pays only official USDC on Base or Base Sepolia and records settled spend locally as well as on compatible Loopfare proxies.

Buyer private keys are stored in `~/.loopfare/config.json`. The directory is mode `0700` and the file is mode `0600`. `wallet create` does not print the private key unless `--show-private-key` is explicitly supplied.

## Seller API

Public endpoints:

- `GET /` — marketing website
- `GET /api` — service and endpoint metadata
- `GET /docs`, `/docs/:page`, `/docs/:page.md` — public documentation
- `GET /health`, `/health/live`, `/health/ready` — health checks
- `GET /skill.md` — agent instructions
- `POST /v1/auth/signup` — seller signup
- `POST|GET /v1/buyer/budget` — token-protected buyer budget
- `GET /demo/v1/fortune` — x402 demo
- `ANY /p/:projectSlug/*` — paid reverse proxy

Seller endpoints require `Authorization: Bearer lf_…`:

- `GET /v1/auth/me`
- `POST /v1/auth/rotate-key`
- `GET|POST /v1/projects`
- `GET|DELETE /v1/projects/:id`
- `GET|POST /v1/projects/:id/routes`
- `PATCH|DELETE /v1/projects/:id/routes/:routeId`
- `GET /v1/projects/:id/payments`
- `GET /v1/payments`

## Security boundaries

- Seller API keys are shown once and stored as SHA-256 hashes.
- Arbitrary seller origins are checked at configuration time and immediately before every proxy request. Private, loopback, link-local, metadata, multicast, and reserved destinations are blocked in production.
- Redirects from seller origins are not followed.
- Authorization, cookies, payment signatures, budget tokens, hop-by-hop headers, and internal Loopfare headers are not forwarded to seller origins; origin cookies are not returned to buyers.
- Proxy request and response sizes are capped, upstream calls time out, security headers are applied, CORS is allowlisted, and management/proxy rate limits are enabled.
- Real payments settle only after the seller origin succeeds. Successful settlement headers and transaction hashes are preserved and recorded.
- Payment history is scoped to the authenticated seller account.
- Buyer budgets use a separate secret token. They are a compatible-client safety rail, not a wallet-level policy.
- Production refuses to boot with dev payments enabled.

See [SECURITY.md](./SECURITY.md) for reporting and incident response.

## Documentation

The hosted documentation center is available at `/docs`. Every guide also has a raw Markdown form at `/docs/<slug>.md` for agents, search indexing, and offline use.

| Start here | Product use | Build and operate |
| --- | --- | --- |
| [Quickstart](./docs/QUICKSTART.md) | [Seller manual](./docs/SELLER_MANUAL.md) | [API reference](./docs/API_REFERENCE.md) |
| [Core concepts](./docs/CONCEPTS.md) | [Buyer manual](./docs/BUYER_MANUAL.md) | [Architecture](./docs/ARCHITECTURE.md) |
| [FAQ](./docs/FAQ.md) | [CLI reference](./docs/CLI_REFERENCE.md) | [Self-hosting](./docs/SELF_HOSTING.md) |
| [Glossary](./docs/GLOSSARY.md) | [Troubleshooting](./docs/TROUBLESHOOTING.md) | [Operations](./docs/OPERATIONS_MANUAL.md) |
| [Agent integration](./docs/AGENT_INTEGRATION.md) | [Error reference](./docs/ERROR_REFERENCE.md) | [Security model](./docs/SECURITY_MODEL.md) |

The [production checklist](./docs/PRODUCTION.md) and [contributor guide](./docs/CONTRIBUTING.md) complete the public manual set.

## Verification

```bash
npm run check
npm audit --omit=dev
```

`npm run check` runs strict TypeScript checks, the API test suite, and production builds for both workspaces.

## Railway deployment

The repository includes `railway.toml`, `nixpacks.toml`, and a production runbook at [docs/PRODUCTION.md](./docs/PRODUCTION.md).

Required Railway resources:

1. A service rooted at the repository root.
2. A volume mounted at `/data`.
3. A generated or custom HTTPS domain.
4. These initial variables:

```env
NODE_ENV=production
LOOPFARE_DEV_MODE=false
ALLOW_PRIVATE_ORIGINS=false
SIGNUP_ENABLED=true
LOOPFARE_NETWORK=base-sepolia
FACILITATOR_URL=https://x402.org/facilitator
DATABASE_PATH=/data/loopfare.db
```

Set `DEMO_PAY_TO` to an operator-controlled Base address before enabling the paid demo. Railway supplies `PORT` and `RAILWAY_PUBLIC_DOMAIN`; the service derives its public URL automatically when `PUBLIC_URL` is unset.

Keep the public beta on Base Sepolia until the mainnet gate in the production runbook is complete.

## Repository layout

```text
loopfare/
├── packages/api/       Hono API, website, paid proxy, SQLite
├── packages/cli/       Seller and buyer CLI
├── docs/                Public guides, references, and operator manuals
├── SECURITY.md
├── railway.toml
└── nixpacks.toml
```

## License

[MIT](./LICENSE)
