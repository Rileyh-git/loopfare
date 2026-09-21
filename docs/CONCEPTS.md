# Core concepts

Loopfare is an x402 reverse proxy. It adds machine-readable payment requirements in front of an existing HTTP API and forwards a request only after the payment path succeeds.

## Participants

| Participant | Responsibility |
| --- | --- |
| Seller | Owns an API origin, chooses prices, and controls the receiving address. |
| Buyer | Requests a protected resource and authorizes a payment. |
| Loopfare | Publishes the price, verifies the request, enforces proxy policy, and records settled usage. |
| Facilitator | Verifies the signed payment and submits or confirms settlement. |
| Origin | The seller's existing HTTP service that receives sanitized paid traffic. |

## Seller account

A seller account owns projects. It authenticates to `/v1` management endpoints with a one-time `lf_…` Bearer key. Loopfare stores a SHA-256 digest and a short display prefix, not the recoverable key.

Buyer calls to `/p/…` do not use seller API keys.

## Project

A project is a public namespace and receiving address:

- `name` is a seller-facing label.
- `slug` becomes part of `/p/<slug>/…` and is globally unique.
- `pay_to` is the EVM address advertised in payment requirements.

Deleting a project also deletes its routes. Payment rows are retained without foreign-key enforcement to preserve history, subject to the operator's retention policy.

## Protected route

A route combines:

- one project;
- a path pattern such as `/v1/*` or `/reports/:id`;
- allowed HTTP methods;
- an origin URL;
- a USD-denominated price string;
- an optional description; and
- an enabled state.

Route matching happens after the `/p/<project>` prefix is removed. Exact paths, named single segments, and trailing wildcards are supported. More specific behavior is not inferred from route order; avoid overlapping patterns.

## x402 request lifecycle

1. A buyer sends an ordinary HTTP request to a paid URL.
2. Loopfare finds the project and route and validates the origin.
3. Without valid payment, Loopfare returns HTTP `402` and `PAYMENT-REQUIRED`.
4. The buyer selects a supported requirement, signs a payment, and retries with `PAYMENT-SIGNATURE`.
5. The facilitator verifies the payment.
6. Loopfare atomically reserves any compatible server budget and sends the sanitized request to the origin.
7. If the origin fails with status 400 or higher, x402 does not settle. The application conservatively retains unconfirmed real-payment reservations until reconciled.
8. If the origin succeeds, the facilitator settles the payment.
9. Loopfare returns the origin response with `PAYMENT-RESPONSE` and records the payment.

The origin response is buffered by x402 settlement hooks and capped by `MAX_PROXY_RESPONSE_BYTES`.

## Price and asset

Sellers express a route price as a decimal dollar amount such as `$0.001`. The current exact EVM scheme advertises USDC payment requirements on the configured network.

The bundled CLI pays only the official USDC contract for:

- Base Sepolia, CAIP-2 `eip155:84532`; or
- Base mainnet, CAIP-2 `eip155:8453`.

The public beta stays on Base Sepolia. Testnet units have no intended monetary value.

## Settlement versus verification

Verification establishes that a payment payload satisfies the advertised requirement. Settlement is the facilitator's successful onchain result. Loopfare records a real payment only when:

- the seller origin returned a status below 400; and
- x402 added `PAYMENT-RESPONSE` after successful settlement.

The transaction hash is decoded from the settlement response when supplied.

## Buyer wallet

The CLI uses a local EVM private key to sign exact payments. The key is stored only on the buyer machine unless an environment override is used. Loopfare is not a wallet and does not custody funds.

Treat a software-agent wallet as a hot wallet:

- keep its balance small;
- use a separate address from treasury funds;
- restrict filesystem access;
- rotate it after suspected exposure; and
- monitor onchain activity independently.

## Budgets

The CLI has two cooperative safety layers:

- a local daily counter; and
- a token-protected budget record on compatible Loopfare servers.

The server persists a reservation before forwarding a verified request. Unknown outcomes stay counted across UTC rollover. Budget setup requires signed wallet ownership, but compatible request headers remain an optional application control; other x402 servers do not honor them. Settled payer metrics use the facilitator receipt, not the wallet header.

Budgets are not a substitute for wallet policy, limited balances, or transaction authorization controls.

## Reverse-proxy trust boundary

Seller origins are untrusted. Loopfare:

- normalizes the configured URL;
- resolves DNS at configuration time and immediately before use;
- validates the actual socket lookup to resist DNS rebinding;
- blocks non-public address ranges by default;
- never follows redirects;
- removes credentials, cookies, payment headers, hop-by-hop headers, and budget hints;
- strips origin `Set-Cookie` headers;
- limits request and response size; and
- times out upstream calls.

Loopfare intentionally does not forward seller-specific secrets. Origins that require private authentication need a separate, explicitly designed credential integration.

## Storage model

The service stores accounts, projects, routes, payment events, and budgets in SQLite. Production uses WAL mode and a single Railway replica with a persistent `/data` volume. Multi-replica operation requires migration to a shared database and distributed rate limiting.

## Test mode and production mode

`LOOPFARE_DEV_MODE=true` accepts a development payment header without crypto. It is for local integration tests only. A process with `NODE_ENV=production` refuses to start in development payment mode.

Production does not mean mainnet. The hosted service is a production-operated Base Sepolia beta until the separate mainnet gate is complete.
