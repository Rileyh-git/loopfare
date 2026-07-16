# Operations manual

This manual covers day-to-day operation, deployment, incident response, backup, restore, and rollback for a single-replica Loopfare service. Commands use `api` as the Railway service name; replace it when your service differs.

## Service inventory

| Surface | Purpose | Authentication |
| --- | --- | --- |
| `GET /` | Public product website | None |
| `GET /api` | Public version and protocol metadata | None |
| `GET /health/live` | Process liveness | None |
| `GET /health/ready` | SQLite readiness | None |
| `/v1/auth/*` | Seller signup, identity, and key rotation | Signup is public when enabled; other routes use a Bearer API key |
| `/v1/projects/*` | Projects, protected routes, payments, earnings | Seller Bearer API key |
| `/v1/buyer/budget/*` | Compatible-client budget state | Separate budget token |
| `/p/:projectSlug/*` | Public x402 paid reverse proxy | x402 payment; budget headers are optional |
| `/demo/v1/fortune` | Optional paid demonstration | x402 payment, or local dev payment outside production |

External dependencies are DNS, seller origins, the x402 facilitator, Base RPC/infrastructure used by the facilitator and clients, Railway, and the persistent volume.

## Operating principles

- Keep the public beta on Base Sepolia until the mainnet gate is signed off.
- Keep exactly one application replica while using SQLite.
- Treat seller API keys, budget tokens, payment signatures, wallet private keys, and facilitator credentials as secrets.
- Prefer application rollback over data restore. A restore discards writes after the selected recovery point.
- Use request IDs to correlate user reports, application logs, edge logs, and upstream reports.
- Never test a destructive procedure for the first time during a live incident.

## Health and observability

### Health probes

- `/health/live` proves the Node process can answer HTTP.
- `/health/ready` executes a trivial SQLite query and returns 503 when it fails.
- `/health` reports version, network, demo state, and timestamp. It is public and must not expose secrets.

Railway should use `/health/ready` as its deployment health check. An external monitor should check both liveness and readiness from outside Railway.

### Logs

Application request logs are JSON and include `requestId`, method, path, status, and duration in milliseconds. Health requests are intentionally omitted from request logs. Error logs add a stable message such as `blocked_origin` or `request_failed`. Production errors omit stack traces.

Responses include:

- `X-Request-Id`: client-provided value, truncated to 100 characters, or a generated UUID.
- `X-Response-Time`: application time.
- `X-Loopfare-Request-Id`: added to proxied upstream requests and responses.

Useful Railway commands:

```bash
railway logs --service api --since 30m --filter "@level:error"
railway logs --service api --http --status ">=500" --since 30m
railway logs --service api --http --filter "@totalDuration:>=1000" --since 30m
railway logs --service api --http --request-id REQUEST_ID
railway deployment list --service api --limit 10
```

Avoid logging full authorization or payment headers. When sharing logs, remove emails, wallet addresses, payment metadata, tokens, query values, and upstream response bodies unless specifically required and approved.

### Minimum alerts

Configure alerts for:

- readiness failures for two consecutive checks;
- any restart loop or crashed deployment;
- sustained HTTP 5xx rate above the normal baseline;
- a sharp increase in 402, 403, or 429 responses;
- p95 application or edge latency above the agreed target;
- volume capacity above 70%, then page at 85%;
- facilitator verification or settlement failures;
- unusual seller signup volume;
- backup job failure or missed restore drill.

Loopfare does not yet expose Prometheus metrics, distributed traces, facilitator-specific counters, or an audit-log stream. Use Railway HTTP/application logs and external synthetic checks until those are implemented.

## Daily checklist

1. Confirm the active deployment is healthy and not restarting.
2. Check `/health/ready` externally.
3. Review new 5xx errors and slow requests.
4. Check facilitator status and payment error trends.
5. Check volume use and last successful backup.
6. Review unexpected signup, key rotation, route change, and high-volume payment reports.
7. Confirm the public network is the intended network.

## Release and deployment runbook

### Before deployment

```bash
git status --short
npm ci
npm run check
npm audit --omit=dev
```

Then:

1. Review code and dependency changes.
2. Confirm deployment variables are correct and no development override is present.
3. Create a manual volume backup and record its identifier and timestamp.
4. Confirm a recent restore drill exists.
5. Announce the change window when user-visible risk is material.

### Deploy

```bash
railway status
railway up --service api --detach --message "Release VERSION COMMIT"
railway logs --service api --latest
```

Railway sends `SIGTERM` when replacing a deployment. Set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10` so Loopfare can close the server, HTTP dispatcher, and SQLite connection. Keep `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0`: two live deployments writing the same SQLite volume violate the intended single-process topology even though SQLite serializes individual writes.

### Verify

```bash
curl --fail https://YOUR_DOMAIN/health/live
curl --fail https://YOUR_DOMAIN/health/ready
curl --fail https://YOUR_DOMAIN/api
```

Verify all of the following:

- reported version and network are expected;
- the website renders with security headers;
- seller authentication works with a test account;
- a test project can be read and its route resolves;
- the expected 402 challenge is returned without payment;
- one approved low-value Sepolia payment settles and reaches the origin;
- a database record persists after a controlled restart;
- error and request logs remain free of credentials.

### Observe

Watch errors, latency, payment outcomes, and database messages for at least 30 minutes or one representative traffic window. Record the deployment ID, commit, operator, verification result, and backup used.

## Backup runbook

### Railway volume backups

Railway supports manual and scheduled backups for mounted volumes, including SQLite. In the API service's **Backups** tab:

1. Enable daily, weekly, and monthly schedules where the plan permits.
2. Keep multiple recovery points. Railway's current default schedule retention is documented in its [backup reference](https://docs.railway.com/volumes/backups).
3. Trigger a manual backup before application or schema changes.
4. Name the change record with the backup timestamp.
5. Monitor backup completion and available volume capacity.

Railway notes that wiping a volume deletes its backups and that restores are limited to the same project and environment. Maintain an independent retention strategy if business requirements require cross-project, cross-region, or provider-exit recovery.

SQLite uses WAL mode. A raw filesystem copy must include database, WAL, and shared-memory state or use SQLite's online backup API. Never copy only `loopfare.db` from a running instance and call it a valid backup.

### Backup acceptance test

A backup is not considered usable until a restore test proves:

- the database passes an integrity check;
- account, project, route, payment, and buyer budget row counts are plausible;
- hashed API key authentication still works with a controlled test account;
- route matching and read endpoints work;
- the source backup and restore timestamps are documented.

Run this drill at least quarterly and after material database changes.

## Restore runbook

A restore is a data-changing operation. Name an incident commander and record the recovery point objective before proceeding.

1. Determine whether an application rollback is sufficient. If data is not corrupt, do not restore it.
2. Announce a maintenance window. Stop or edge-block writes to signup, management, budget, demo, and proxy endpoints. `SIGNUP_ENABLED=false` alone is not maintenance mode; existing users and proxy payments can still write.
3. Record the current deployment ID, volume ID, database size, and last known good transaction time.
4. Create a final backup of the current volume when safe, even if it may be damaged.
5. In Railway's API service **Backups** tab, select the approved backup and choose **Restore**.
6. Review the staged change. Railway mounts the restored data as a replacement volume at the same path and retains the previous volume unmounted.
7. Deploy the staged restore.
8. Confirm there is one replica and `DATABASE_PATH=/data/loopfare.db`.
9. Verify readiness, database integrity, account/project/route counts, and a controlled test flow before reopening traffic.
10. Monitor for missing post-recovery writes and communicate the exact data-loss window.

Do not delete the previous volume until the restore is accepted and the retention window expires. Railway warns that restoring a backup removes newer backups than the selected recovery point; review current platform behavior before every restore.

With traffic stopped, an operator can run SQLite's integrity check through the installed runtime:

```bash
railway ssh --service api node --input-type=module --eval \
  'import Database from "better-sqlite3"; const db = new Database("/data/loopfare.db", { readonly: true }); console.log(db.pragma("integrity_check")); db.close();'
```

The expected result is a single `ok` row. Preserve the database and escalate rather than attempting ad hoc repair when any other result appears.

## Application rollback

Use rollback for a bad application release when the data remains trustworthy.

1. Stop the rollout and declare the impact.
2. In Railway, open the API service's Deployments tab, select the previously successful deployment, and choose **Rollback**.
3. Confirm which image and variables Railway will restore. Railway deployment rollback restores both the selected image and that deployment's custom variables.
4. Verify `/health/ready`, network selection, seller authentication, route lookup, and a controlled payment.
5. Watch logs for schema compatibility errors.

Current database migrations are forward-only and additive, and legacy columns are retained. That helps older code continue reading the database, but is not a permanent compatibility guarantee. A code rollback never reverses schema or data changes.

## Incident management

### Severity guide

| Severity | Examples | Initial response |
| --- | --- | --- |
| SEV-1 | Incorrect settlement, widespread unauthorized access, private-key exposure, database corruption or loss | Page immediately, stop affected flows, name incident commander, preserve evidence |
| SEV-2 | Paid proxy or facilitator unavailable for many users, sustained readiness failures, major data delay | Respond within the on-call target, mitigate or roll back, issue status update |
| SEV-3 | Single seller route failure, elevated latency, isolated signup or CLI issue | Triage in business hours unless escalating |

For every incident, record start time, detection source, impact, affected network, deployment ID, request IDs, mitigations, decisions, and communication. Preserve relevant logs without copying secrets into the incident document.

### Facilitator outage or settlement failures

1. Confirm health using a controlled Sepolia request and inspect payment/facilitator errors.
2. Do not mark requests paid or bypass x402.
3. Keep already configured routes intact and communicate that new paid requests may fail.
4. If a verified alternative facilitator exists, switch only under a reviewed change with an end-to-end test.
5. Reconcile application payment events with facilitator and chain records after recovery.

### Database locked, full, or unavailable

1. Check readiness, restarts, volume capacity, filesystem errors, and duplicate replicas.
2. Stop duplicate writers. Do not repeatedly restart a full or corrupt volume.
3. Increase volume capacity when full, then verify SQLite can write.
4. If corruption is suspected, stop writes, preserve the volume, and restore a tested backup.
5. Document any lost event window and reconcile settlements externally.

### Compromised seller API key

1. Rotate the key immediately with `POST /v1/auth/rotate-key` or `loopfare rotate-key` using the still-valid credential.
2. If the caller cannot authenticate, close signups and restrict traffic while an operator-led recovery is performed; there is no administrative account recovery endpoint today.
3. Review project, route, and payment records plus request logs for unauthorized changes.
4. Disable suspicious routes and notify affected origin operators.
5. Remove leaked keys from logs, tickets, shell history, and CI stores where possible.

### Buyer private-key exposure

Loopfare's server does not store buyer private keys; the CLI stores one locally. Move remaining funds to a new wallet immediately, stop using the old wallet, replace local configuration, set a new budget token, and review chain activity. A Loopfare budget is not an on-chain allowance and cannot revoke wallet authority.

### Suspected SSRF or malicious origin

1. Disable or delete the route and retain its metadata.
2. Confirm `ALLOW_PRIVATE_ORIGINS=false` and inspect `blocked_origin` events.
3. Review DNS answers over time, unusual target ports, request IDs, and egress telemetry.
4. Treat access to metadata or private addresses as SEV-1 and rotate any possibly exposed platform credentials.
5. Review other routes owned by the same seller.

### Traffic or signup abuse

1. Set `SIGNUP_ENABLED=false` when new account creation is part of the abuse.
2. Apply edge-level rate limits or blocks. The built-in limiter is in-memory, per-process, and trusts selected forwarded-IP headers.
3. Preserve request IDs and edge source data.
4. Do not add replicas as an abuse response while SQLite remains the store.

## Routine secret rotation

- Seller API key: `loopfare rotate-key`; the previous key stops working immediately.
- Budget token: no rotation endpoint exists. A new token cannot replace an existing token for the same wallet through the API today; handle as an engineering change or move to a new wallet record.
- Buyer wallet key: create/import a replacement locally and move funds on-chain.
- Facilitator credentials: follow the provider procedure, stage securely, redeploy, and run a low-value payment test.
- `ADMIN_API_KEY`: changing it does not rotate an already-created bootstrap account key. Rotate through the seller endpoint instead.

## Troubleshooting matrix

| Signal | Checks | Mitigation |
| --- | --- | --- |
| Readiness 503 | Volume mounted, permissions, free space, database error logs | Restore storage access; preserve data before repair |
| Restart loop | Latest deploy logs, invalid env, port, database open, Node version | Correct configuration or roll back image and variables |
| 400 on route creation | URL syntax, credentials/query in origin, DNS answers, reserved address | Correct origin; do not weaken SSRF settings publicly |
| 402 `budget_exceeded` | Server budget, local CLI counter, price, UTC day boundary | Raise budget intentionally or wait for reset; never silently bypass |
| 403 `invalid_budget_token` | Correct wallet/token pair, lost local config | Restore token from secure backup; there is no recovery endpoint |
| 404 `route_not_found` | Project slug, method list, enabled flag, pattern, route order | Correct request or route configuration |
| 502 `origin_unavailable` | DNS safety result, upstream DNS/TLS/port, timeout | Repair seller origin; correlate by request ID |
| Unexpected upstream 3xx | Redirects are passed through because proxy redirect mode is manual | Client follows only after evaluating destination and payment semantics |
| Frequent 429 | Client IP header trust, caller fan-out, in-memory bucket | Fix edge headers or add edge policy; do not add replicas blindly |
| Earnings differ from chain | Event record is not reconciliation ledger; tx hash may be absent | Reconcile facilitator and chain data, then investigate event capture |

## Decommissioning

1. Disable signup and announce end of service.
2. Stop new paid traffic at the edge.
3. Export required operational and legal records.
4. Take and verify a final backup.
5. Remove the public domain and application deployment.
6. Retain or destroy volumes and backups according to the published retention policy.
7. Revoke facilitator credentials and archive incident/release records.

Deleting a Railway volume also deletes its backups. Require two-person review for that action in production.
