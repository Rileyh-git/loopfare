# Safety update and rollout checklist

This describes v0.3.0 following the September 20 review. Do not move the existing v0.2.7 tag onto these changes. Railway startup creates and checks a one-time pre-migration SQLite backup on the persistent volume before loading the API. This is not an off-site or scheduled backup.

## Compatibility changes

- Wallet create/import refuse an existing wallet without `--replace`. Back up the old key first. Pending reservations prevent replacement. `wallet import --stdin` avoids shell-history exposure. Corrupt configuration fails closed without overwriting it.
- Remote API/call URLs require HTTPS; HTTP loopback works for development. API keys and budget tokens are scoped by origin. `set-api --switch-profile` explicitly changes credential-bearing profiles. Redirects are rejected; network calls have a 30-second deadline and 10 MiB response ceiling.
- Paid calls default to Base Sepolia and a 1 USDC per-call maximum. Use `--network`, `--max-price`, and `--pay-to` for explicit policies. Daily budgets remain required unless deliberately disabled. Use disposable test wallets.
- Budgets use durable reservation IDs and integer atomic reservation amounts. Unknown outcomes remain counted across UTC midnight. `budget reservations` displays local state. Automatic on-chain reconciliation is not claimed: obtain authoritative settlement evidence before manual recovery. Never delete pending entries to make another payment fit.
- Budget setup now requires a signed ownership challenge; old CLIs cannot configure budgets against this API. Updating a budget preserves spend. Wallet controllers can rotate lost/claimed server tokens with a new signed challenge.
- Only GET/HEAD paid proxy methods are supported. Paid writes return 405 until durable write idempotency exists. Verified payment-signature replay claims prevent the same signature invoking an origin again, but are not general write idempotency or an exactly-once guarantee.
- Non-dev routes require origin authentication and verification. Legacy unverified routes are refused. Origin changes or credential rotation disable the route until it is reverified.
- Project deletion archives it; `/v1/payments` retains seller history. Archived slugs remain reserved. Seller mainnet volume excludes testnet/demo/dev/test transactions; it is not platform revenue.
- Metrics require the dedicated `METRICS_API_KEY`. An account named `owner@loopfare.local` has no operator privilege. Public signup cannot claim reserved local identities. Account keys still cannot be recovered by email: retain them securely and rotate while authenticated.

## Operator preparation

1. Take a verified SQLite-aware backup and separately back up secrets. Retain the previous immutable application image. A raw database-file copy may omit WAL state.
2. Configure `ORIGIN_ENCRYPTION_KEY` as 64 cryptographically random hex characters in the deployment secret store. Do not put it in git or logs. It encrypts origin secrets using AES-256-GCM with route-bound authenticated data. Losing it requires seller credential reconfiguration. Master-key rotation requires explicit re-encryption; do not simply replace it on an existing database.
3. Keep `ALLOW_PRIVATE_ORIGINS=false` in production; startup rejects true. Keep the hosted beta on Sepolia. `FACILITATOR_API_KEY` optionally supplies Bearer authentication to a compatible HTTPS facilitator; this does not implement provider-specific JWT schemes.
4. Forwarded IPs are untrusted by default. Set `TRUSTED_CLIENT_IP_HEADER` to `x-real-ip` or `cf-connecting-ip` only after verifying ingress overwrites it and cannot be bypassed. Otherwise rate limits fall back to socket peers, potentially aggregating users behind a proxy. Live Railway ingress behavior is not verified by local tests.
5. Coordinate CLI/server rollout because budget setup and route enablement contracts changed. Smoke-test the packed package before publishing a new tag. Do not advertise the old registry package as containing new commands.
6. Run `npm run check` and `npm audit --omit=dev`. Protocol tests use the real middleware with a controlled facilitator and intercepted origins; no funds move.

## Seller origin setup and rotation

Enforce the secret on **every paid origin endpoint**, not only the ownership check. Verification demonstrates endpoint control and a checked authentication path; it cannot prove that every seller route enforces access correctly. Never echo the secret in responses or log it.

Create a strong secret in a private file, then configure the origin to require it in `X-Loopfare-Origin-Secret`:

```sh
loopfare init --email you@example.com --name 'My API' --slug unique-api-name \
  --pay-to 0xYOUR_RECEIVING_ADDRESS --origin https://your-origin.example \
  --origin-secret-file /absolute/path/to/private-secret --path '/v1/*' --price '$0.001'
```

The command prints project/route IDs, a verification path, and a random challenge. Serve that path as plain text: return 401/403 without the secret and exactly the challenge with it. Then:

```sh
loopfare verify-origin PROJECT_ID ROUTE_ID
```

Verification uses the same SSRF controls as proxying, rejects redirects, bounds responses, and enables the route after both checks succeed. Test direct access to each paid origin endpoint yourself; unauthorized requests must fail. Then call the public proxy using a disposable Sepolia wallet.

For rotation, install the new secret at the origin and run `loopfare origin-secret PROJECT_ID ROUTE_ID --file /private/new-secret`, then verify again. This temporarily disables the route. Coordinate rotation with the seller. The per-route secret is distinct from the encryption master key.

`examples/text-analysis-origin.mjs` supplies a bounded read-only example. Set `ORIGIN_SECRET`, `LOOPFARE_ROUTE_ID`, and `LOOPFARE_ORIGIN_CHALLENGE`, then place its loopback listener behind HTTPS. `/v1/analyze` returns word/character counts and a hash without storing input. Input is limited to 4 KiB. Hosting logs may still capture query strings: use only non-sensitive sample text.

## Signed budget authorization

POST `/v1/buyer/budget/challenge` with `{walletAddress,dailyLimitUsd}` and `X-Loopfare-Budget-Token`. The returned message binds origin, wallet, limit, token digest, random nonce, and five-minute expiry. Sign locally, then POST the same fields plus `nonce` and `signature` to `/v1/buyer/budget` with the same token.

The signature is verified and the nonce consumed once. A verified wallet controller can rotate a lost or preclaimed token without resetting spend. Tokens cannot sign on-chain transfers. This EOA signature flow does not implement contract-wallet verification. `loopfare budget set` handles it for the local wallet.

## First-party analytics

CLI installation tracking is off by default: `telemetry on` opts in; `telemetry off` disables it and removes the identifier. Browser DNT/GPC and `X-Loopfare-Telemetry: off` suppress usage events and new cookies. Necessary transactional account/payment records remain. No Sentry or external analytics SDK was added.

Only allowlisted campaign values are retained. Arbitrary query strings, bodies, payment signatures, and raw installation IDs are not stored in analytics. Identifiers are HMAC pseudonyms, not anonymous people. Verified settlement receipts—not claimed wallet headers—supply paying-wallet identity. Mark your own HTTP requests `X-Loopfare-Traffic: test`; historical unmarked traffic cannot be identified as external retroactively.

Expected unpaid 402s are separated from errors. Retained historic demo challenges are corrected once and daily summaries rebuilt. Unknown historical errors are not guessed away. Payment segments separate chain, demo, test, and mode. Missing historical networks remain unknown, not commercial volume. Acquisition ratios are aggregate ratios, not joined cohorts. Request-level campaigns are not cross-device attribution.

## Backups, readiness, and alerts

```sh
node scripts/backup.mjs /absolute/path/to/live.sqlite /absolute/path/to/new-backup.sqlite
```

The script uses SQLite's online backup API, refuses an existing target, creates private files, then opens the backup for integrity and foreign-key checks. It reports counts, not keys or row content. It exits nonzero on failure and can run in an approved job runner. Configure provider schedules/retention separately. Perform restore drills in an isolated environment, never by replacing the live volume.

`/health/live` checks process liveness, `/health/ready` database readiness, and `/health/payments` the facilitator's advertised exact-scheme support. Payment checks have a five-second timeout and thirty-second cache. They do not guarantee settlement, finality, backups, or end-to-end success. Failed checks emit structured warnings. The website no longer calls a DB probe “all systems operational.”

Alert on readiness failures, unknown payment operations, stale backup verification, settlement/upstream failures, and disk capacity. Logs/probes are provided; configuring a production notification destination remains an operator task. No external monitoring account is assumed.

## Remaining external acceptance gates

- Live: Railway backup schedule and isolated restore drill, trusted-ingress verification, deployment secret provisioning, and registry installation after a new publish.
- Human: three unfamiliar developer onboarding sessions and an independent review before mainnet.
- Deliberately gated: paid writes, automatic chain reconciliation/finality, email recovery, OS keychain storage. Interim behavior is read-only routing, durable unknown reservations, explicit API-key-only recovery limitations, and mode-600 local wallet files.

The old v0.2.7 attempt passed verification but its publish job was cancelled before steps ran. The updated workflow checks tag type, serializes releases per ref, and verifies registry installation after publish. It does not bypass runner cancellation or assume account-side npm trusted publishing is correct.
