# Security model

This document describes the security properties and trust boundaries of Loopfare 0.3.1. It is a design description, not a security certification. Review it before exposing an instance to untrusted sellers, buyers, or origins.

Security reports should follow [the repository security policy](../SECURITY.md).

## Security goals

Loopfare aims to:

- require a valid x402 payment before forwarding a protected request;
- settle seller payments directly to the address configured for that project;
- keep buyer private keys off the Loopfare server;
- isolate seller management data by account;
- prevent seller-supplied origins from reaching local, private, metadata, or reserved networks by default;
- protect high-entropy seller and buyer budget tokens at rest;
- fail closed when production configuration is unsafe or invalid;
- provide request-level correlation without intentionally logging secrets.

Loopfare does not claim to provide:

- custody, escrow, refunds, chargebacks, or wallet recovery;
- a wallet-level or smart-contract-enforced buyer spending limit;
- a complete accounting ledger or blockchain reconciliation system;
- DDoS protection, web application firewalling, or globally coordinated rate limits;
- end-to-end confidentiality when a seller configures an HTTP origin;
- tenant isolation equivalent to separate processes or networks;
- identity verification, compliance screening, or legal authorization to transact.

## Actors and assets

### Actors

- **Buyer or buyer agent:** calls a paid endpoint and signs an x402 payment with its own wallet.
- **Seller:** owns a Loopfare account, project, receiving address, routes, and upstream origin.
- **Operator:** deploys Loopfare, controls infrastructure, variables, domains, backups, and incident response.
- **Facilitator:** verifies and settles x402 payments.
- **Origin operator:** runs the seller's upstream HTTP service. This may or may not be the same party as the seller account owner.
- **Infrastructure provider:** terminates TLS, routes traffic, stores the volume, and retains platform logs.
- **Attacker:** may be an unauthenticated internet client, malicious buyer, malicious seller, compromised origin, dependency attacker, or compromised operator account.

### Protected assets

- seller API keys and account email addresses;
- buyer wallet private keys stored by the CLI;
- buyer budget tokens and budget state;
- project receiving addresses, origin URLs, route rules, prices, and payment event metadata;
- facilitator credentials when a future authenticated integration is configured;
- application availability and the integrity of payment gating;
- SQLite data, backups, infrastructure credentials, and operational logs.

Receiving addresses and on-chain transactions are public by nature. Treat the association between an address and an account email as private operational data.

## Trust boundaries

```text
                               operator trust boundary
                     +-----------------------------------+
                     |  deployment variables and logs    |
                     |                                   |
Internet             |  +-----------------------------+  |
buyer/seller --------+->| Loopfare HTTP application   |  |
                     |  |                             |  |
                     |  | auth | x402 | proxy | site  |  |
                     |  +----+------+-------+---------+  |
                     |       |      |       |            |
                     |       |      |       +-----------> seller origin
                     |       |      +-------------------> facilitator / Base
                     |       v                           |
                     |  SQLite on persistent volume     |
                     +-----------------------------------+

Buyer private key boundary: local CLI configuration only; never sent to Loopfare.
Seller origin boundary: seller-controlled and potentially hostile to Loopfare and callers.
Facilitator boundary: trusted to verify/settle according to x402 and report results correctly.
```

TLS normally terminates at the hosting edge. The operator must ensure edge-to-container transport, forwarded client addresses, certificate lifecycle, and platform access controls meet the deployment's risk requirements.

## Authentication and authorization

### Seller API keys

Signup returns an `lf_` API key once. The server stores a SHA-256 digest and a short display prefix, not the recoverable key. The legacy `api_key` column is retained for compatibility but contains `hashed:<digest>` after migration. Because generated keys have high entropy, a fast digest is appropriate for lookup; it would not be sufficient for human-chosen passwords.

Authenticated seller endpoints require `Authorization: Bearer <key>`. Project access checks the authenticated account ID, and payment listings are account- or project-scoped. A missing project and a project owned by another account both return 404, reducing direct resource enumeration.

Key rotation invalidates the old key immediately. There is no password login, email verification, session, role system, operator account-recovery endpoint, or multi-factor authentication. Anyone holding a seller API key has full management authority for that account.

`ADMIN_API_KEY` may bootstrap `owner@loopfare.local` on an empty database. After that account exists, changing the environment variable does not rotate its stored key.

`METRICS_API_KEY` grants read-only access to `GET /v1/admin/metrics` and is compared in constant time. It is not a seller credential. Generate and rotate it independently. No public email identity or bootstrap seller key grants metrics access. See the [safety rollout checklist](HARDENING.md).

### Usage analytics privacy

Browser visitors receive an opaque, first-party `lf_session` cookie with `HttpOnly`, `SameSite=Lax`, a one-year maximum age, and `Secure` on HTTPS deployments. CLI, agent, bot, and generic API-client requests do not create analytics cookies. Only an HMAC-SHA256 digest of the cookie value is stored. Network and wallet identifiers in usage events are HMAC-protected with a random secret generated into the persistent database.

The usage store does not retain raw IP addresses, complete user-agent strings, or referrer query strings. It stores a coarse client category and a referrer origin plus path. Health probes, the metrics endpoint, and static browser assets are excluded. Recognized bots are tagged and excluded from product aggregates. Raw usage events are deleted after `USAGE_RETENTION_DAYS`; daily aggregate rows remain available for trend reporting.

Transactional tables remain separate from analytics. New settled payment rows use the facilitator receipt's payer identity. Legacy buyer hints were client-supplied and are not verified payer identities. DNT/GPC and CLI opt-out suppress usage events, not necessary transaction records.

### Buyer budget tokens

Budget endpoints accept a separate high-entropy token through `X-Loopfare-Budget-Token` or Bearer authorization. Its SHA-256 digest is stored. Setting or rotating it requires an EOA wallet signature over a domain-bound challenge with a single-use nonce and five-minute expiry.

A budget token is not a wallet key and cannot sign transactions. Proof of wallet control is required for setup/rotation; read access requires the token. Rotation preserves spent and pending amounts.

### CORS

CORS is enforced only on `/v1/*` browser calls and uses exact configured origins. It does not authenticate callers, protect non-browser clients, or restrict paid proxy routes. Bearer keys and budget tokens remain the authorization boundary.

## Payment trust model

Loopfare uses x402 v2 with the `exact` EVM scheme on Base Sepolia or Base. For a protected request:

1. The route determines price, receiving address, network, and description.
2. The resource server challenges an unpaid request.
3. A compatible buyer signs the selected requirement.
4. The configured facilitator verifies it.
5. Loopfare atomically reserves an optional compatible-client budget, then calls the origin.
6. The facilitator settles only after the origin handler succeeds and adds `PAYMENT-RESPONSE`.
7. Loopfare records confirmed settlement and returns the response. Unknown outcomes retain durable reservations, including across day rollover. A verified payment-signature claim prevents replay from invoking the origin again. Paid writes remain disabled.

The facilitator is trusted to enforce scheme semantics and report verification and settlement accurately. Its availability or compromise directly affects this boundary. Mainnet must not use the public testnet facilitator. Optional Bearer authentication is supported for compatible providers; provider-specific JWT integrations require additional work.

Application payment rows record requested price, status, route/project, path, an optional buyer hint, and a transaction identifier when it can be decoded from `PAYMENT-RESPONSE`. They do not provide finality monitoring or reconcile against on-chain state. Earnings are a sum of application events, not audited revenue.

Development payment headers are synthetic authorization. Production startup refuses `LOOPFARE_DEV_MODE=true`; operators must not bypass that check.

## Buyer budget limitations

The CLI accepts only official USDC assets on Base and Base Sepolia and selects the least expensive compatible requirement. By default it requires a configured daily budget and records settled spend locally. The server can also enforce a daily budget when both wallet and budget-token headers are supplied.

These are safety rails, not custody controls:

- A buyer can omit budget headers and use another x402 client.
- A caller can assert any wallet header; the budget token is the server's authority.
- The CLI serializes local budget reservation with a short-lived lock and atomic config-file replacement; process crashes can still leave conservative reserved spend until an operator reconciles the file.
- The server records integer-amount reservations before forwarding and retains unconfirmed spend. A missing response never automatically frees real-payment spend. This is an application safety rail, not a strict on-chain cap.
- Reset occurs by UTC date, not the buyer's local timezone.
- An attacker with the wallet private key can pay independently of Loopfare.

Use a low-balance wallet, wallet-native policy, or smart-account controls for a hard loss limit.

## Reverse proxy boundary

### Request routing

The public proxy extracts the project slug and path, finds the first enabled route in newest-first creation order whose method and path pattern match, validates payment, then appends the path and query string to the configured origin base URL.

Path patterns support exact paths, `:parameter` segments, and a trailing `/*`. Route order matters when patterns overlap. Project slugs are globally unique.

### SSRF controls

Origin creation and updates require an HTTP or HTTPS URL without embedded credentials, query string, or fragment. Loopfare blocks known local/internal names and rejects addresses in loopback, private, link-local, carrier-grade NAT, metadata-adjacent, multicast, documentation, reserved, and unspecified ranges.

The host is resolved when the route is created or changed, before each proxied request, and again in a custom DNS resolver at the socket connection boundary. A DNS response containing any blocked address is rejected, which closes the ordinary validation-to-connect DNS rebinding window. `ALLOW_PRIVATE_ORIGINS=false` is mandatory for a public multi-tenant deployment.

Residual risks include:

- a public origin that is itself an open proxy or has access to private systems;
- domain ownership or DNS control changing after a route is approved;
- allowed public services that expose sensitive data;
- arbitrary public TCP ports over HTTP(S);
- differences between platform egress controls and application address classification;
- application-layer attacks against the upstream caused by attacker-controlled paths, queries, headers, or bodies.

Use platform egress policy and network telemetry as a second boundary where available.

### Header handling

Loopfare strips request authorization, cookies, payment headers, budget headers, host/content-length, proxy credentials, and hop-by-hop headers before forwarding. It adds `X-Forwarded-By: loopfare` and `X-Loopfare-Request-Id`. Origins that require a secret Authorization or Cookie header are not supported by this version.

Most end-to-end request headers, including content type, origin, referer, and user agent, are forwarded. Most response headers are also returned. Hop-by-hop, content-encoding, content-length, `Set-Cookie`, and `Set-Cookie2` response headers are removed. Cookie stripping prevents a seller origin from setting cookies on the shared Loopfare domain.

Redirects are not followed by Loopfare (`redirect: manual`); the 3xx response is returned to the caller. A caller that follows a redirect creates a new request outside the original payment/origin decision and must evaluate it independently.

### Resource limits

Upstream connections have a configurable timeout. The `/v1/*` management API and `/p/*` paid proxy have request-body limits and in-memory per-client rate limits. The demo also has a per-client rate limit. The Undici dispatcher caps proxied responses. Platform edge limits, seller limits, timeouts, and capacity monitoring remain necessary.

## Data protection

SQLite stores account emails, key digests/prefixes, projects, routes, payment events, buyer wallet addresses, budget-token digests, and budget counters. It does not store seller or buyer wallet private keys. The CLI stores buyer keys, seller API keys, and budget tokens in `~/.loopfare/config.json`, sets the directory to mode `0700`, and the file to mode `0600`.

Filesystem permissions do not protect against malware or another process running as the same OS user. Buyers should use a dedicated low-balance wallet and platform key management when their threat model requires it.

Encryption at rest, backup encryption, administrator access, and log retention are infrastructure responsibilities. The application has no field-level encryption, data-export endpoint, deletion-by-email workflow, or configured retention job. Publish and implement a data retention policy before collecting production user data.

## HTTP and browser controls

The application sets a Content Security Policy, frame restrictions, referrer policy, permissions policy, and other secure headers. The marketing page is implemented inline, so its current policy permits inline scripts and styles. This weakens CSP protection compared with nonces or external hashed assets.

The website does not use seller Bearer keys or buyer wallet keys. Keep management interfaces and future dashboards free of ambient cookie authentication unless CSRF protection and cookie isolation are designed explicitly.

## Rate limiting and client identity

`/v1/*` uses process-local fixed-window counters. Seller signup has an additional five-per-hour bucket. The client identifier is chosen from `CF-Connecting-IP`, `X-Real-IP`, or the first `X-Forwarded-For` entry.

The hosting edge must overwrite these headers. If untrusted clients can supply them, rate limits can be bypassed or one victim can be charged against another bucket. All unknown clients share a bucket when no supported header is present. Counters reset on restart and are not shared across replicas.

Use edge rate limiting for public abuse resistance. Do not horizontally scale this implementation merely to increase limiter capacity because SQLite and counters assume a single replica.

## Logging and privacy

Structured request logs include method and path, so route paths and project slugs are visible to the operator. Query strings are not included in the normal application request log, but the hosting edge may log them. Error reasons may include origin validation details outside production responses.

Never place secrets in paths or query strings. The application intentionally does not log request/response bodies or full headers, but infrastructure and seller origins have independent logging behavior. A client-provided request ID is truncated but otherwise not validated; treat it as untrusted text.

## Dependency and build trust

The build uses `npm ci` and the committed lockfile. Runtime dependencies include Hono, better-sqlite3, Undici, Zod, and Coinbase x402 packages. `better-sqlite3` is a native dependency, so build-platform and binary provenance matter.

Release controls should include lockfile review, `npm audit --omit=dev`, source/dependency scanning, a clean build, and prompt upgrades for Node.js and security fixes. An audit result of zero known advisories is not proof of absence of vulnerabilities.

## Threat/control matrix

| Threat | Current controls | Important residual risk |
| --- | --- | --- |
| Stolen seller key | High entropy, hash at rest, immediate rotation | No MFA, recovery, roles, or management audit log |
| Database disclosure | No plaintext API/budget tokens; CLI private keys absent | Emails, routes, wallet associations, and payment metadata remain sensitive |
| SSRF / metadata access | URL validation, blocked ranges, repeated DNS checks, socket-boundary resolver | Public open proxies, public-to-private pivots, arbitrary public ports |
| Payment bypass | x402 middleware before proxy; dev mode rejected in production | Facilitator correctness and dependency vulnerabilities |
| Buyer overspend | USDC/network allowlist, atomic local reservation, atomic optional server reservation/refund | Not wallet-enforced; other clients and direct wallet use can bypass application limits |
| Cross-tenant data access | Account ownership checks and scoped payment queries | Shared process/database/domain; no formal row-level database policy |
| Abuse / DDoS | Management/proxy rate and byte limits, timeout, hosting edge | Limiter is local and spoofable if edge is misconfigured; demo needs edge controls |
| Malicious seller origin | Sensitive request headers and response cookies stripped, redirects not followed | Other response headers and content remain seller-controlled |
| Database loss | WAL, persistent volume, provider backups | Single volume, manual restore validation, no cross-provider export automation |
| Supply-chain compromise | Lockfile and reproducible install | Large dependency trust base and native code |

## Secure deployment checklist

- [ ] `NODE_ENV=production`
- [ ] `LOOPFARE_DEV_MODE=false`
- [ ] `ALLOW_PRIVATE_ORIGINS=false`
- [ ] Base Sepolia selected unless every mainnet gate is approved
- [ ] HTTPS domain active and `PUBLIC_URL` correct
- [ ] Exact `CORS_ORIGINS` configured
- [ ] One replica and persistent SQLite volume
- [ ] Daily/weekly/monthly backups enabled and a restore tested
- [ ] Edge overwrites client-IP headers and applies proxy abuse limits
- [ ] No secrets in build output, logs, repository, tickets, or URLs
- [ ] Controlled seller-key rotation and wallet-compromise procedures tested
- [ ] Facilitator and dependency versions reviewed
- [ ] Legal, privacy, support, and retention documents published before real users
- [ ] Independent proxy/payment review complete before mainnet

## Open security work before broad production use

The most important current hardening items are:

1. Add per-tenant/global concurrency controls and equivalent explicit limits to the demo route.
2. Add authenticated mainnet facilitator configuration and secret rotation.
3. Add management audit events, operator recovery, maintenance mode, and data export/deletion workflows.
4. Replace inline website script/style allowances with nonces, hashes, or static assets.
5. Add settlement reconciliation and finality monitoring.
6. Add centralized metrics, alerting, and a shared edge rate-limit policy.

These items should be tracked publicly when disclosure does not increase active risk; sensitive exploit details belong in private vulnerability reporting.
