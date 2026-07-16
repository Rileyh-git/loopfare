# Self-hosting Loopfare

This guide is for operators who want to run the Loopfare API, marketing site, and x402 proxy on their own infrastructure. The repository defaults to Base Sepolia and is suitable for a public testnet beta. Mainnet has additional release gates described below.

## What you are running

One Node.js process serves all public surfaces:

```text
Internet
   |
   | HTTPS
   v
Load balancer / TLS terminator
   |
   v
Loopfare API (one replica) --------> x402 facilitator
   |       |
   |       +-----------------------> seller HTTP origins
   |
   +---- SQLite database on persistent storage
```

The process serves the website at `/`, seller management endpoints at `/v1/*`, paid proxy endpoints at `/p/:projectSlug/*`, and health endpoints at `/health/*`.

SQLite is the primary store. Run exactly one application replica against a database file. Multiple processes or hosts must not share the file over a network filesystem. Move to a client/server database before horizontal scaling.

## Prerequisites

- Node.js 22 or newer and the npm version bundled with it.
- A Linux or macOS host with persistent local storage.
- An HTTPS domain and reverse proxy or a hosting platform that terminates TLS.
- A Base Sepolia facilitator for the default testnet deployment.
- A controlled EVM receiving address if the paid demo will be enabled.

For production, pin deployments to a reviewed commit and keep the lockfile in the build context.

## Build and run locally

```bash
git clone https://github.com/Rileyh-git/loopfare.git
cd loopfare
npm ci
cp .env.example .env
npm run check
npm run build -w @loopfare/api
node packages/api/dist/index.js
```

The sample configuration intentionally enables development payment bypasses and private origins. It is for a developer workstation only. Verify the local process with:

```bash
curl --fail http://localhost:4021/health/live
curl --fail http://localhost:4021/health/ready
curl --fail http://localhost:4021/api
```

## Production configuration

Loopfare reads `.env` from the current working directory or repository root, then validates every value at startup. On a hosting platform, prefer its secret and variable store over a committed `.env` file.

| Variable | Default | Production guidance |
| --- | --- | --- |
| `NODE_ENV` | `development` | Required: `production`. Production startup rejects development payment mode. |
| `PORT` | `4021` | Listening port. Hosting platforms may inject this value. |
| `HOST` | `0.0.0.0` | Keep `0.0.0.0` in a container; use a loopback address only behind a local reverse proxy. |
| `PUBLIC_URL` | Derived | Final externally visible HTTPS origin, with no trailing slash. On Railway it may be omitted when `RAILWAY_PUBLIC_DOMAIN` is present. |
| `RAILWAY_PUBLIC_DOMAIN` | Unset | Injected by Railway and used to derive `PUBLIC_URL`. Do not set manually elsewhere. |
| `DATABASE_PATH` | `./data/loopfare.db` | Put this on persistent storage, for example `/data/loopfare.db`. |
| `LOOPFARE_NETWORK` | `base-sepolia` | Keep `base-sepolia` for beta. `base` is blocked when the public testnet facilitator is configured. |
| `FACILITATOR_URL` | `https://x402.org/facilitator` | Testnet facilitator URL. Mainnet requires a mainnet-capable authenticated integration. |
| `DEMO_PAY_TO` | Zero address | Set a controlled address to enable the paid demo; leave zero to disable it. |
| `DEMO_PRICE` | `$0.001` | Dollar-denominated price from `$0.000001` upward, with at most six decimal places. |
| `LOOPFARE_DEV_MODE` | `false` | Required: `false`. Never accept synthetic payments on a public service. |
| `ALLOW_PRIVATE_ORIGINS` | `false` | Required: `false` unless the instance is isolated and intentionally proxies an internal network. |
| `SIGNUP_ENABLED` | `true` | Set `false` to close new seller registration during an incident or controlled beta. Existing accounts still work. |
| `ADMIN_API_KEY` | Unset | Optional high-entropy bootstrap key of at least 24 characters. Prefer normal signup and rotation. |
| `CORS_ORIGINS` | `PUBLIC_URL` origin | Comma-separated exact browser origins. CORS is not an authentication mechanism. |
| `PROXY_TIMEOUT_MS` | `30000` | Upstream timeout, from 1,000 to 120,000 milliseconds. |
| `MAX_REQUEST_BODY_BYTES` | `1048576` | Maximum `/v1/*` and `/p/*` request body size, from 1 KiB to 10 MiB. |
| `MAX_PROXY_RESPONSE_BYTES` | `10485760` | Maximum proxied upstream response size, from 64 KiB to 100 MiB. |

Minimum public beta values:

```env
NODE_ENV=production
LOOPFARE_DEV_MODE=false
ALLOW_PRIVATE_ORIGINS=false
SIGNUP_ENABLED=true
LOOPFARE_NETWORK=base-sepolia
FACILITATOR_URL=https://x402.org/facilitator
DATABASE_PATH=/data/loopfare.db
PUBLIC_URL=https://loopfare.example
```

Do not put seller API keys, buyer private keys, budget tokens, or payment signatures in environment variables that are printed by build tooling. Loopfare does not need a server-side buyer private key.

## Generic single-host deployment

1. Provision a dedicated unprivileged service account and a writable data directory.
2. Build the application from a reviewed commit with `npm ci` and `npm run build -w @loopfare/api`.
3. Place the environment file outside the checkout and restrict it to the service account.
4. Run `node packages/api/dist/index.js` under a process supervisor such as systemd.
5. Terminate HTTPS in a reverse proxy and forward to `127.0.0.1:4021`.
6. Configure the proxy to pass a trustworthy client address header and remove any client-supplied copy of that header.
7. Monitor `/health/ready` and keep the data directory on backed-up persistent storage.

Give the process a graceful termination window of at least 10 seconds. Loopfare handles `SIGTERM` and `SIGINT`, stops accepting requests, closes the HTTP dispatcher and SQLite database, and exits. Do not send production traffic directly to an unencrypted port.

## Railway deployment

The repository includes `railway.toml` and `nixpacks.toml`. They select Node.js 22, run `npm ci`, compile the API, start the compiled server, and use `/health/ready` as the health check.

### 1. Link the project and service

Install and authenticate the Railway CLI, then run from the repository root:

```bash
railway login
railway link
railway status
```

Choose the intended project, environment, and `api` service. Use explicit `--project`, `--environment`, and `--service` flags in automation.

### 2. Attach persistent storage

Add a Railway volume to the API service and mount it at `/data`:

```bash
railway volume add --mount-path /data
railway volume list
```

Set `DATABASE_PATH=/data/loopfare.db`. Railway volumes are available at runtime, not during the build phase. Keep the service at one replica while it uses SQLite.

### 3. Set variables

Set non-secret values in one operation to avoid unnecessary intermediate deploys:

```bash
railway variable set \
  NODE_ENV=production \
  LOOPFARE_DEV_MODE=false \
  ALLOW_PRIVATE_ORIGINS=false \
  SIGNUP_ENABLED=true \
  LOOPFARE_NETWORK=base-sepolia \
  FACILITATOR_URL=https://x402.org/facilitator \
  DATABASE_PATH=/data/loopfare.db \
  RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10 \
  RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0
```

Use `railway variable set SECRET_NAME --stdin` for secrets so they do not enter shell history. Do not set `PUBLIC_URL` until the domain is known; Railway's injected `RAILWAY_PUBLIC_DOMAIN` will be used automatically.

### 4. Add a domain and deploy

```bash
railway domain --service api --port 4021
railway up --service api --detach --message "Deploy reviewed Loopfare release"
railway logs --service api --lines 100
```

For a custom domain, pass it to `railway domain` and create the returned DNS record. Once TLS is active, set `PUBLIC_URL` to the final HTTPS origin and, if browser clients use different origins, set `CORS_ORIGINS` explicitly.

### 5. Verify the deployment

```bash
export LOOPFARE_URL=https://your-domain.example
curl --fail "$LOOPFARE_URL/health/live"
curl --fail "$LOOPFARE_URL/health/ready"
curl --fail "$LOOPFARE_URL/api"
curl --fail "$LOOPFARE_URL/"
```

Confirm the metadata reports `base-sepolia`, `demoEnabled` has the intended value, the database survives a redeploy, and logs contain no credentials. Create a test seller, route, and testnet payment before opening registration.

Railway references: [Volumes](https://docs.railway.com/volumes), [volume backups](https://docs.railway.com/volumes/backups), and [deployment actions](https://docs.railway.com/deployments/deployment-actions).

## Backup and restore requirement

Before accepting users, enable Railway's daily, weekly, and monthly volume backup schedules, or an equivalent provider-native snapshot policy. The SQLite database uses WAL mode; the database file and its `-wal` and `-shm` companions live in the same directory. Do not copy only the main database file while the service is running.

Test a restore into a non-production environment before launch and at least quarterly. See [OPERATIONS_MANUAL.md](./OPERATIONS_MANUAL.md) for the full procedure.

## Upgrade procedure

1. Read the release notes and inspect schema changes.
2. Run `npm ci`, `npm run check`, and `npm audit --omit=dev` from a clean checkout.
3. Create a manual volume backup and record its timestamp.
4. Deploy the reviewed commit.
5. Verify readiness, the website, seller authentication, route lookup, and a testnet payment.
6. Watch errors and latency for at least one normal traffic window.

Current schema changes are additive and run at process startup. Never assume a code rollback reverses data changes. Restore data only for corruption or a specifically approved data rollback.

## Mainnet gate

Do not change `LOOPFARE_NETWORK` to `base` until every item is complete:

- A mainnet-capable facilitator is configured, including its authentication and key-rotation procedure.
- A low-value end-to-end payment, verification, settlement, and seller receipt test has passed.
- Receiving wallet ownership, multisig policy, recovery, and incident authority are documented.
- Terms, privacy notice, refund policy, sanctions/compliance position, and a monitored support contact are published.
- Facilitator availability, rejected payments, gas costs, and settlement reconciliation are monitored.
- The proxy and payment path have received an independent security review.
- Restore and rollback drills have passed, with named operators.

The startup validator intentionally refuses Base mainnet when `FACILITATOR_URL` points at `x402.org`.

## Capacity and scaling limits

- Run one replica. In-memory rate limits and SQLite state are not coordinated across replicas.
- Payments and earnings are recorded as application events; they are not an accounting ledger or blockchain reconciliation system.
- The x402 settlement hook buffers protected upstream responses and rejects responses beyond `MAX_PROXY_RESPONSE_BYTES`.
- Route origins must be publicly resolvable when private origins are disabled.
- Browser CORS settings affect `/v1/*`; paid proxy callers are not restricted by CORS.

Plan a Postgres migration, shared rate limiter, durable job processing, and dedicated metrics before horizontal scaling or contractual availability targets.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Startup says configuration is invalid | Malformed URL, address, price, boolean, or numeric range | Correct the named variable; startup intentionally fails closed. |
| Startup rejects development mode | `NODE_ENV=production` and `LOOPFARE_DEV_MODE=true` | Set development mode to `false`; never bypass this check. |
| Startup rejects mainnet facilitator | `LOOPFARE_NETWORK=base` with the public testnet facilitator | Return to Sepolia or configure and validate a mainnet-capable integration. |
| `/health/ready` returns 503 | SQLite cannot answer a trivial query | Inspect volume attachment, permissions, free space, database integrity, and logs. |
| Data disappears after redeploy | Database was on ephemeral storage | Attach persistent storage and set `DATABASE_PATH` to its mount. Restore from a backup if available. |
| Route creation rejects an origin | URL is malformed, non-HTTP(S), private, reserved, or has a blocked DNS answer | Use a public origin. Only enable private origins on an isolated, intentional self-hosted network. |
| Proxy returns `origin_unavailable` | DNS safety check, connection failure, or unsafe stored origin | Correlate logs using `X-Request-Id`, then verify DNS and origin health. |
| Paid request remains 402 | Missing/invalid payment, unsupported network/asset, or budget rejection | Inspect `PAYMENT-REQUIRED`, client wallet funding, facilitator health, and budget state. |
| SQLite reports locked/busy | Long transaction, stuck process, multiple replicas, or storage issue | Confirm a single process, stop duplicate writers, and investigate disk latency. |
| All callers share one rate-limit bucket | Trusted client-IP headers are absent | Configure the edge proxy to overwrite a supported client address header. |

## Uninstalling

Export or retain required records, stop traffic, take a final backup, and only then remove the service. Deleting or wiping a Railway volume also deletes its backups. Removing the application deployment does not automatically remove the attached volume.
