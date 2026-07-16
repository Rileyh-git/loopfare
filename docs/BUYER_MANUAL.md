# Loopfare buyer manual

Loopfare lets a command-line client pay an x402 v2 endpoint per request. The CLI receives the endpoint's HTTP 402 challenge, selects a supported USDC payment requirement, signs it with a local EVM key, retries the request, and reports the response and settlement status.

The current public beta is **Base Sepolia** (`eip155:84532`). Base Sepolia assets have no real-world value. Start with a fresh test-only wallet and never import a wallet that holds meaningful mainnet assets just to evaluate the beta.

## Before you begin

You need:

1. Node.js 22 or later.
2. The Loopfare CLI built from this repository.
3. The HTTPS URL of a Loopfare deployment.
4. Base Sepolia test USDC for real x402 test payments, or a local Loopfare server with development payments enabled.

Build and link the current CLI:

```bash
npm ci
npm run build -w @loopfare/cli
npm link -w @loopfare/cli
loopfare set-api https://loopfare.example
```

`set-api` is needed for budget operations. `loopfare call` accepts a full paid URL and can also call other compatible x402 endpoints directly.

## Wallet safety first

The CLI is a **local hot-wallet client**. It can sign payments without another confirmation prompt. Follow these rules:

- Use a dedicated, low-value wallet. Do not import a primary wallet or treasury key.
- During the beta, keep only test assets in the wallet.
- Back up the key in an encrypted secret manager before funding the address.
- Never paste the private key into chat, issue reports, logs, screenshots, shell scripts, or source control.
- Treat `~/.loopfare/config.json` as a secret. The CLI creates its directory with mode `0700` and the file with mode `0600`, but file permissions do not protect against malware or another process running as your user.
- Set a daily budget before making real payment calls. A budget reduces mistakes but is not an on-chain allowance or absolute wallet guarantee.
- Rotate to a new dedicated wallet if the private key may have been exposed. There is no remote revocation for an EVM private key.

Environment keys are supported for automation:

```bash
export EVM_PRIVATE_KEY=0xREDACTED
# LOOPFARE_PRIVATE_KEY is also supported when EVM_PRIVATE_KEY is unset.
```

Process environment variables override the stored private key. Keep the stored wallet address consistent with the environment key; `wallet show` and budget setup can otherwise refer to the stored address while a paid call signs with the environment key.

## Complete first-payment workflow

### 1. Create a dedicated wallet

```bash
loopfare wallet create
```

The command prints the address and stores the private key without printing it. If you deliberately need one-time terminal output for immediate transfer into a secret manager, use:

```bash
loopfare wallet create --show-private-key
```

Terminal output and scrollback may be logged, so the safer backup is an encrypted copy of `~/.loopfare/config.json`. `wallet create` replaces any wallet currently stored in that file; back up the old key first. It clears the previous budget token, limit, and local spend counter so they cannot be reused with the new address. Run `budget set` before paying.

Confirm the address:

```bash
loopfare wallet show
```

### 2. Fund it with Base Sepolia test assets

The CLI points to the Coinbase developer faucet:

```text
https://portal.cdp.coinbase.com/products/faucet
```

Fund the exact address shown by `wallet show` with the test assets required by the x402 endpoint. Loopfare's CLI will only pay the official USDC contract for the requirement's Base network:

| Network | CAIP-2 ID | Accepted USDC contract |
| --- | --- | --- |
| Base Sepolia | `eip155:84532` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Although the client recognizes both entries, the current Loopfare public beta should advertise Base Sepolia only. Do not make Base mainnet payments until the operator explicitly announces that the mainnet release gate is complete.

### 3. Set the daily budget

```bash
loopfare budget set --daily 5
loopfare budget show
```

The value is USD/USDC per UTC day, must be greater than zero, and cannot exceed `$1,000,000`.

The first `budget set` generates a secret `lb_...` budget token in the local configuration. The API stores only its hash and binds it to the wallet. The token is then sent with Loopfare calls so the proxy can enforce its own spend record. Keep this token secret: someone with both the wallet address and token can read or change that wallet's Loopfare budget.

Budget behavior has two layers:

1. **Local CLI policy** selects only an affordable official-USDC requirement and records settled spend in `~/.loopfare/config.json`.
2. **Loopfare proxy policy** checks the budget token and wallet headers, then records spend for successful calls made through a compatible Loopfare proxy.

Both counters reset when the UTC date changes. The CLI reserves local spend under a short-lived file lock before signing, and the server uses an atomic database reservation before forwarding a verified request. These are still application safety rails, not an on-chain wallet limit: calls that bypass Loopfare, another wallet client, a lost counter, or `--no-budget` can spend outside the intended amount. For a strict asset-level cap, keep only the maximum amount you are prepared to lose in the dedicated wallet.

### 4. Make a paid call

```bash
loopfare call https://loopfare.example/p/weather/v1/forecast
```

For JSON request bodies:

```bash
loopfare call https://loopfare.example/p/tools/v1/summarize \
  --method POST \
  --header 'Accept: application/json' \
  --data '{"text":"A short passage"}'
```

When `--data` is present, the CLI sends `Content-Type: application/json`; the current client does not provide a way to override that content type. GET and HEAD calls cannot include `--data`.

The result includes:

- HTTP `status` from the final endpoint response;
- `paymentStatus` reported by the x402 client;
- the settlement response header, when present;
- the parsed response `body`;
- the signing wallet address;
- the updated local budget summary, or `{ "enforced": false }`.

The command exits nonzero if the final HTTP response is not successful or a payment/setup error occurs.

## Understand the x402 exchange

A real call generally makes two HTTP requests:

1. The buyer sends an ordinary request.
2. The server responds `402` with a v2 `PAYMENT-REQUIRED` challenge.
3. The CLI filters requirements to official USDC on Base or Base Sepolia, filters out prices above the remaining budget, and chooses the cheapest compatible requirement.
4. The wallet signs the payment payload.
5. The CLI retries with `PAYMENT-SIGNATURE`.
6. The server/facilitator verifies and settles the payment, then returns the protected resource and a `PAYMENT-RESPONSE`.

Do not blindly retry payment failures in a tight loop. First determine whether settlement occurred; network interruptions can make a client uncertain even when an external system accepted a request.

## Development payments

Local development mode tests the product flow without crypto:

```bash
loopfare call http://localhost:4021/demo/v1/fortune --dev
```

`--dev` sends `LOOPFARE-DEV-PAYMENT: ok`. It works only if the server operator started a non-production service with `LOOPFARE_DEV_MODE=true`. It does not create an x402 signature or transfer USDC. The CLI labels the response `payment: "dev"`.

For automated local tests, `LOOPFARE_DEV_PAYMENT=1` has the same client-side effect as `--dev`:

```bash
LOOPFARE_DEV_PAYMENT=1 loopfare --json call http://localhost:4021/demo/v1/fortune
```

Never interpret a dev response or a `dev_settled` seller event as a blockchain settlement.

## Import an existing test wallet

```bash
loopfare wallet import --private-key 0xREDACTED
```

The `0x` prefix is optional. The CLI derives and saves the address. The private key is a command-line argument and may be retained in shell history or process inspection; prefer `EVM_PRIVATE_KEY` for automation and use a secret-injection mechanism that does not log values.

Importing overwrites the stored wallet and clears the old wallet's budget token, limit, and local spend fields. Run `budget set` for the new wallet before paying. Use separate operating-system users or isolated home directories when automations need independent wallets.

## Requests and headers

Supported methods are `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`:

```bash
loopfare call URL --method PATCH --data '{"enabled":true}'
```

Add headers with the variadic `-H`/`--header` option. Put the URL before the header list so header parsing cannot consume it:

```bash
loopfare call URL \
  -H 'Accept: application/json' 'X-Trace-Id: test-123'
```

An item without a colon is silently ignored. Avoid supplying your own `PAYMENT-SIGNATURE`, `X-Loopfare-Wallet`, or `X-Loopfare-Budget-Token`; the client manages those. The Loopfare proxy removes payment credentials, the budget token, the wallet hint, buyer authorization, and cookies before forwarding the request to a seller origin.

## Calls without a configured budget

Real payments fail closed when no local daily budget and budget token are configured. The explicit escape hatch is:

```bash
loopfare call URL --no-budget
```

This disables the CLI's local price ceiling and budget report for that call. A pre-existing Loopfare budget token may still be sent, so a Loopfare proxy can still reject the call under its server-side policy. `--no-budget` should be reserved for controlled troubleshooting with a deliberately low-value wallet.

## JSON automation

Place the global option before the command:

```bash
loopfare --json wallet show
loopfare --json budget show | jq '.budget.remainingTodayUsd'
loopfare --json call URL >result.json
```

Errors also use JSON on stdout and exit nonzero. Check both:

```bash
if ! output="$(loopfare --json call "$PAID_URL")"; then
  printf '%s\n' "$output" >&2
  exit 1
fi
printf '%s\n' "$output" | jq '.body'
```

Do not enable shell tracing (`set -x`) around commands or environment assignments containing private keys.

## Troubleshooting

### `No wallet`

Run `loopfare wallet create` or provide `EVM_PRIVATE_KEY`. Then confirm the expected address with `wallet show`.

### `No hard budget is configured`

Run `loopfare budget set --daily AMOUNT`. Use `--no-budget` only when you intentionally accept the risk.

### `Payment exceeds the remaining daily budget`

Inspect `loopfare budget show`. Increase the limit with `budget set`, wait for the UTC-day reset, or choose a lower-priced route. Also inspect `loopfare config` for the local counter.

### `Invalid budget token`

The stored token does not own the server-side budget for that wallet. This can happen after copying configurations between machines or changing wallets. The current API does not provide token recovery or takeover; preserve the original token and avoid creating multiple independent configurations for one wallet.

### `Loopfare CLI only pays USDC on Base or Base Sepolia`

The endpoint advertised a different network or asset contract. Do not work around the policy by signing manually unless you have independently verified the asset, recipient, network, amount, and server.

### Insufficient funds or facilitator error

Verify the wallet has the official USDC for the exact advertised network and that the facilitator is healthy. Base Sepolia and Base mainnet balances are separate. The service's `/health` endpoint checks the application database, not wallet funds or full facilitator settlement.

### A raw request returns 402

That is expected. Use `loopfare call` or another x402 v2 client. A normal browser, `curl`, or `fetch` without x402 payment middleware does not automatically sign the challenge.

### `demo_not_configured`

The operator has not supplied a receiving wallet for the hosted demo. Use a seller's paid proxy URL or ask the operator to configure the demo.

### Non-2xx origin response after payment

Payment unlocks the proxy request; it does not guarantee the seller origin will return success. Record the request ID and settlement result before retrying. Refunds are not automated in the current beta.

### Configuration looks wrong

Run:

```bash
loopfare config
```

It reports the config path, API URL, redacted API-key prefix, wallet address, whether a private key and budget token exist, the daily limit, and the local UTC-day spend. Check for environment overrides: `LOOPFARE_API_URL`, `LOOPFARE_API_KEY`, `EVM_PRIVATE_KEY`, and `LOOPFARE_PRIVATE_KEY`.

## Current buyer limitations

- The public beta is Base Sepolia testnet, not a production mainnet payment service.
- The CLI pays only exact-scheme official USDC requirements on Base and Base Sepolia.
- Budget state is application/local state, not a smart-contract allowance or bank-style control.
- Concurrent CLI processes serialize local budget reservation through a short-lived lock. A stale lock older than 30 seconds is recovered; otherwise retry the command if another process is updating the budget.
- There is no wallet balance command, key export command, hardware-wallet integration, refund workflow, or transaction-history explorer in the CLI.
- The CLI is currently built from the repository rather than installed from a public package registry.

Every command and flag is listed in [CLI_REFERENCE.md](./CLI_REFERENCE.md). Sellers should read [SELLER_MANUAL.md](./SELLER_MANUAL.md).
