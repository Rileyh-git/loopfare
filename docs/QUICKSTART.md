# Quickstart

This guide takes you from a clean checkout to a protected endpoint and a paid test request. Loopfare is currently a Base Sepolia beta. Base Sepolia uses test assets only.

## What you will build

You will run the Loopfare website, API, and CLI; create a seller project; put an x402 gate in front of an HTTP origin; and call a protected resource in local development mode. The same route can then be tested with Base Sepolia USDC.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Git
- curl
- An HTTPS API origin you control for public testing
- For real testnet payments: Base Sepolia USDC in a disposable buyer wallet

Install the public CLI from npm in a second terminal after starting the local service.

## 1. Install and start Loopfare

```bash
git clone https://github.com/Rileyh-git/loopfare.git
cd loopfare
# Optional when nvm is installed: nvm use
cp .env.example .env
npm ci
npm run dev
```

Open `http://localhost:4021`. The readiness endpoint should answer with `{"ok":true}`:

```bash
curl --fail http://localhost:4021/health/ready
```

## 2. Install the CLI

In a second terminal:

```bash
npm install --global @loopfare/cli@latest
loopfare --version
loopfare doctor
loopfare set-api http://localhost:4021
```

Contributors changing the CLI can instead build the checkout and run `npm link -w @loopfare/cli` from the repository root.

Every command supports the top-level `--json` option. Put it before the subcommand, for example `loopfare --json projects list`.

On a fresh machine, `doctor` checks Node.js, the hosted Base Sepolia service, local configuration permissions, wallet state, and budget state. The CLI defaults to `https://api-production-dd0a0.up.railway.app`; this local tutorial then changes it to the server running on your machine.

## 3. Create a seller account

```bash
loopfare signup --email you@example.com --json
```

The API returns an `lf_…` key once. The CLI stores it in `~/.loopfare/config.json` with file mode `0600`. Back up the key in a secret manager. Loopfare cannot email it to you or recover it during the beta.

Confirm the active identity:

```bash
loopfare whoami --json
```

## 4. Create a seller project

For this no-funds local simulation, use the valid placeholder address below. It is not controlled by you; never send assets to it. For a real Base Sepolia test, replace it with an EVM address you control.

```bash
loopfare projects create \
  --name "Weather API" \
  --slug weather \
  --pay-to 0x0000000000000000000000000000000000000001 \
  --json
```

Copy the returned project `id`.

## 5. Protect an origin

For a public deployment, `--origin` must be an HTTP or HTTPS origin that resolves only to public IP addresses. Loopfare blocks local, private, link-local, metadata, multicast, and reserved addresses.

```bash
loopfare protect \
  --project PROJECT_ID \
  --origin https://httpbin.org \
  --path "/*" \
  --methods GET \
  --price '$0.001' \
  --description "Paid echo endpoint" \
  --json
```

The paid URL has this shape:

```text
http://localhost:4021/p/weather/get
```

Loopfare preserves the query string, does not follow origin redirects, strips credentials and payment headers, and returns the origin response only after a real payment settles.

## 6. Make a local development call

The example `.env` enables local development payments. Create a disposable wallet and set a daily budget:

```bash
loopfare wallet create --json
loopfare budget set --daily 5 --json
loopfare call http://localhost:4021/p/weather/get --dev --json
```

`--dev` sends `LOOPFARE-DEV-PAYMENT: ok`. Production refuses to start when development payments are enabled.

If your test origin runs on localhost, keep `ALLOW_PRIVATE_ORIGINS=true` only in local development. It must be `false` in production.

## 7. Test the x402 challenge

Call the route without `--dev` or a payment signature:

```bash
curl -i http://localhost:4021/p/weather/get
```

The response is HTTP `402` and includes the x402 v2 `PAYMENT-REQUIRED` header. A compatible client signs the exact-payment payload and retries with `PAYMENT-SIGNATURE`.

## 8. Make a real Base Sepolia payment

This is a separate post-deploy scenario: deploy Loopfare, point the CLI at its public HTTPS domain, and recreate the seller account, project, and route there with a receiving address you control. Local SQLite state does not transfer to the deployment.

Fund the buyer wallet with Base Sepolia USDC from the [Coinbase developer faucet](https://portal.cdp.coinbase.com/products/faucet). The facilitator submits settlement, so the buyer does not need ETH for Loopfare's exact USDC payment flow. Never fund a generated test wallet with mainnet assets.

```bash
loopfare budget set --daily 1 --json
loopfare call https://YOUR_LOOPFARE_DOMAIN/p/weather/get --json
```

The CLI accepts only official USDC on Base Sepolia or Base. It selects the lowest supported requirement within the remaining local budget, signs, retries, and reports settlement metadata. A successful response contains `PAYMENT-RESPONSE`.

## 9. Inspect activity

```bash
loopfare routes list --project PROJECT_ID --json
loopfare earnings --project PROJECT_ID --limit 50 --json
loopfare budget show --json
```

## Hosted beta

The public documentation and API are available at `https://api-production-dd0a0.up.railway.app`. The paid demo remains disabled until the operator supplies a receiving wallet. Seller signup is available, but you must use an API origin and wallet you control.

For a no-account hosted connectivity test after installing the CLI:

```bash
loopfare doctor
```

For a no-funds end-to-end payment simulation, use the local development workflow in this guide. A real hosted x402 test currently requires a seller-created route plus Base Sepolia test assets.

## Next steps

- Read the [seller manual](./SELLER_MANUAL.md) before publishing a paid route.
- Read the [buyer manual](./BUYER_MANUAL.md) before funding a wallet.
- Use the [API reference](./API_REFERENCE.md) for direct HTTP integrations.
- Follow the [production checklist](./PRODUCTION.md) before handling real value.
