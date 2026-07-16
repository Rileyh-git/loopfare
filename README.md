# Loopfare

**Charge AI agents per request.**

Loopfare is an x402 paywall for Base: put a payment gate in front of any HTTP API, and let agents pay with USDC — no account signup, no API keys for buyers.

| Surface | Role |
| --- | --- |
| **API** | Hosted proxy + seller dashboard API + demo endpoint |
| **CLI** | Seller protect + buyer pay (`--json` for agents) |

## Quick start (local)

```bash
cd ~/Documents/loopfare
cp .env.example .env
# set DEMO_PAY_TO to your Base address (optional for --dev)
npm install
npm run dev
```

In another terminal:

```bash
# Seller
npx tsx packages/cli/src/index.ts set-api http://localhost:4021
npx tsx packages/cli/src/index.ts signup --email you@example.com --json
npx tsx packages/cli/src/index.ts projects create \
  --name Demo --slug demo --pay-to 0xYourAddress --json
npx tsx packages/cli/src/index.ts protect \
  --project <PROJECT_ID> \
  --origin https://httpbin.org \
  --path "/*" \
  --price "$0.001" --json

# Buyer (dev mode — no crypto)
npx tsx packages/cli/src/index.ts call http://localhost:4021/demo/v1/fortune --dev --json
```

## Architecture

```
Agent / CLI
    │
    ▼
Loopfare API  ──x402 402──► pay USDC on Base ──► verify via facilitator
    │
    ▼ (paid)
Your origin API
```

- **Network default:** Base Sepolia (`eip155:84532`)
- **Facilitator default:** `https://x402.org/facilitator` (no signup, testnet)
- **Dev mode:** `LOOPFARE_DEV_MODE=true` accepts `LOOPFARE-DEV-PAYMENT: ok`

## CLI commands

| Command | Description |
| --- | --- |
| `loopfare signup --email …` | Create seller account |
| `loopfare projects create …` | Create project + receiving wallet |
| `loopfare protect …` | Protect an origin URL |
| `loopfare earnings --project …` | Payment history |
| `loopfare wallet create` | Local buyer wallet |
| `loopfare budget set --daily 5` | Daily spend cap |
| `loopfare call <url> [--dev]` | Paid fetch with x402 |

All commands support `--json`.

## Railway deploy

1. Create a new Railway project from this repo
2. Set root to the monorepo root
3. Environment variables:

```env
PORT=4021
PUBLIC_URL=https://YOUR_SERVICE.up.railway.app
LOOPFARE_NETWORK=base-sepolia
FACILITATOR_URL=https://x402.org/facilitator
DEMO_PAY_TO=0xYourReceivingWallet
LOOPFARE_DEV_MODE=false
DATABASE_PATH=/data/loopfare.db
```

4. Attach a **volume** mounted at `/data` so SQLite persists
5. Deploy — healthcheck: `GET /health`

For mainnet later:

```env
LOOPFARE_NETWORK=base
FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
CDP_API_KEY_ID=…
CDP_API_KEY_SECRET=…
```

## Agent skill

Point coding agents at:

- Local: `http://localhost:4021/skill.md`
- Or the repo file [`SKILL.md`](./SKILL.md)

## Repo layout

```
loopfare/
  packages/api/   # Hono server (Railway)
  packages/cli/   # loopfare CLI
  railway.toml
  SKILL.md
```

## Security notes

- Buyer private keys live in `~/.loopfare/config.json` (mode 600) — treat like production secrets
- Set hard budgets before funding agent wallets
- Keep `LOOPFARE_DEV_MODE=false` in production
- This is an MVP: not a bank, not a custodian — sellers receive USDC to their own address

## License

MIT (add when you publish)
