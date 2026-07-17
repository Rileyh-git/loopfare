# Troubleshooting

Start with the response status, JSON `error`, `message`, and `X-Request-Id`. Search the structured service logs for the same request ID. Never post API keys, private keys, budget tokens, or payment signatures in an issue.

## Installation and startup

### npm global install fails with `EACCES`

This means npm's global prefix is owned by the operating system, commonly `/usr/local` on macOS. It is not a Loopfare package failure. Do not run `sudo npm install`, because global package scripts would then run with elevated privileges.

For a no-install test, use:

```bash
npx --yes @loopfare/cli@latest doctor
```

The preferred long-term fix is to install Node.js through a version manager. Alternatively, configure npm to use a directory owned by your user. For zsh on macOS:

```bash
npm config set prefix ~/.local
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
npm install --global @loopfare/cli@latest
loopfare doctor
```

This follows npm's documented user-prefix approach and leaves `/usr/local` ownership unchanged.

### `npm ci` fails while building `better-sqlite3`

Use Node.js 22 on a supported platform with a compiler toolchain and Python available. On Railway, the included Nixpacks plan supplies Node 22 and Python.

### `Invalid Loopfare configuration`

The startup error identifies the invalid variable. Common causes are an invalid EVM address, unsupported network name, malformed public URL, body limits outside their permitted range, or a non-numeric port.

### Production refuses to start with dev mode

Set `LOOPFARE_DEV_MODE=false`. Development payment headers must never be accepted by a production process.

### Production refuses the x402.org facilitator on Base

The free x402.org facilitator is testnet-only. Keep `LOOPFARE_NETWORK=base-sepolia` or implement and configure an authenticated mainnet-capable facilitator before choosing `base`.

## Authentication

### `401 unauthorized`

- Seller endpoint: send `Authorization: Bearer lf_…`.
- Budget endpoint: send the separate `X-Loopfare-Budget-Token`.
- Confirm the CLI is pointed at the expected API with `loopfare config`.
- A successful key rotation invalidates the previous key immediately.

### `409 account_exists`

The email is already registered. The beta has no email recovery flow. Use the existing key or an authenticated rotation; contact the operator only through a verified support process.

### The CLI uses the wrong account

Run `loopfare config` and `loopfare whoami`. `LOOPFARE_API_URL` and `LOOPFARE_API_KEY` override stored values for the current process.

## Projects and routes

### `409 slug_taken`

Project slugs are global. Choose a different lowercase letter/number/hyphen slug.

### Origin validation fails

The origin must:

- use HTTP or HTTPS;
- contain no embedded credentials, query, or fragment;
- avoid local/internal hostnames; and
- resolve only to public IP addresses unless a local development process explicitly allows private origins.

DNS failures also prevent route creation because Loopfare validates reachability before storing the route.

### `404 route_not_found`

Check the project slug, request method, enabled state, and the path after `/p/<slug>`. `/v1/*` matches `/v1` and descendants, while `/v1/:id` matches exactly one segment.

### Origin returns 401 after working directly

Loopfare deliberately strips `Authorization` and cookies. The origin must be publicly callable behind the payment boundary or use a future explicit origin-credential mechanism.

## Payments

### Expected HTTP 402

A first request without `PAYMENT-SIGNATURE` should return 402. Use an x402 v2 client such as `loopfare call`, not ordinary curl, for the paid retry.

### The CLI rejects the payment requirement

The bundled client accepts only exact USDC requirements on Base or Base Sepolia. Confirm the server network and official USDC contract. Other assets or chains require another client integration.

### Insufficient balance or settlement failure

Confirm the buyer has official USDC on the exact advertised network. For the supported x402 exact flow, the facilitator submits settlement and a separate buyer gas balance is not normally required. Review `PAYMENT-REQUIRED`, facilitator availability, and the wallet transaction history.

### Origin succeeded but payment was not recorded

A real event is recorded only if `PAYMENT-RESPONSE` is present after settlement. Search facilitator and service logs with the request ID. An origin status of 400 or greater cancels settlement and is not earnings.

### Demo returns 503

`DEMO_PAY_TO` is not configured on that deployment. Set it to a controlled receiving wallet and redeploy. The public hosted beta is already configured; a 503 there indicates an operator regression.

## Budgets and wallets

### `402 budget_exceeded`

Run `loopfare budget show`. Increase the daily limit only after reviewing the wallet and intended workload. The counter resets by UTC date.

### `403 invalid_budget_token`

The token does not own the budget record for that wallet hint. Creating or importing a new wallet clears local budget fields; run `loopfare budget set` for the new address.

### Environment private key and address disagree

Current CLI code derives the wallet address from the effective private key, including `EVM_PRIVATE_KEY` and `LOOPFARE_PRIVATE_KEY`. Run `loopfare wallet show` to confirm it before funding or setting a budget.

### A budget did not stop another transaction

Loopfare budgets are cooperative application controls, not wallet-level policy. Restrict the wallet balance and signing authority independently.

## Proxy failures

### `502 bad_gateway`

Loopfare could not connect to the origin, DNS changed to a blocked address, TLS failed, or the response exceeded the configured cap. Test the public origin from another network and inspect service logs.

### `504 gateway_timeout`

The origin exceeded `PROXY_TIMEOUT_MS`, which defaults to 30 seconds. Fix the origin or raise the limit cautiously.

### `413 payload_too_large`

The request exceeded `MAX_REQUEST_BODY_BYTES`, default 1 MiB. Upload large objects out of band and pay for a reference-based operation, or adjust the operator limit.

### Cookies disappear

Request `Cookie` and response `Set-Cookie` headers are intentionally stripped to prevent credential leakage and cross-seller cookie injection on the shared Loopfare domain.

## Railway

### Health check never becomes ready

Verify the volume is mounted at `/data`, `DATABASE_PATH=/data/loopfare.db`, Node 22 is selected, and the build compiled `packages/api/dist`. Read build and deployment logs.

### Data disappears after deploy

The database was probably written outside the mounted volume. Confirm `DATABASE_PATH` and the volume mount before accepting traffic.

### SQLite is locked or restarts under load

Keep one application replica. The service uses WAL mode and a five-second busy timeout, but it is not a multi-node database. Review long-running requests and migrate to shared storage before horizontal scaling.

## Reporting a bug

Include:

- Loopfare version and commit;
- local or hosted environment;
- network name;
- exact command with secrets redacted;
- status, safe response body, and request ID;
- expected and actual behavior; and
- minimal reproduction steps.

Report security issues using the private process in `SECURITY.md`, not a public issue.
