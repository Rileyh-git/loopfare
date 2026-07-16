# Loopfare — agent skill

Charge AI agents per request using x402 v2 payments in USDC on Base.

## When to use

- You need to call a paid API and complete HTTP 402 / x402 payment automatically
- You want to put a paywall in front of an existing HTTP origin without rewriting it

## Seller flow

```bash
# point CLI at your Loopfare API
loopfare set-api https://YOUR_RAILWAY_URL

loopfare signup --email you@example.com --json
loopfare projects create --name "My API" --slug my-api --pay-to 0xYOUR_WALLET --json
loopfare protect --project PROJECT_ID --origin https://api.example.com --path "/*" --price '$0.001' --json
```

Agents then call: `https://YOUR_RAILWAY_URL/p/my-api/...`

## Buyer flow

```bash
loopfare wallet create --json
# fund address with Base Sepolia USDC (testnet) via CDP faucet
loopfare budget set --daily 5 --json
loopfare call https://YOUR_RAILWAY_URL/demo/v1/fortune --json
```

## Dev mode (local / no crypto)

If the server has `LOOPFARE_DEV_MODE=true`:

```bash
loopfare call http://localhost:4021/demo/v1/fortune --dev --json
```

## API discovery

- `GET /` — product website
- `GET /api` — product and endpoint metadata
- `GET /health` — healthcheck
- `GET /skill.md` — this skill (live)
- `GET /demo/v1/fortune` — paid demo endpoint

Always pass `--json` for machine-readable output.

Real payments require a configured daily budget unless the operator explicitly passes `--no-budget`. The CLI pays only official USDC on Base or Base Sepolia. Never print, transmit, or commit the wallet private key.
