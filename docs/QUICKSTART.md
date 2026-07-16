# Quickstart

This guide takes you from a clean checkout to a protected endpoint and a paid test request. Loopfare is currently a Base Sepolia beta. Base Sepolia uses test assets only.

## What you will build

You will run the Loopfare website, API, and CLI; create a seller project; put an x402 gate in front of an HTTP origin; and call a protected resource in local development mode. The same route can then be tested with Base Sepolia USDC.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Git
- An HTTPS API origin you control for public testing
- For real testnet payments: Base Sepolia ETH and USDC in a disposable buyer wallet

The CLI is not published to npm during the beta. Run it from this repository or use `npm link` as shown below.

## 1. Install and start Loopfare

```bash
git clone https://github.com/Rileyh-git/loopfare.git
cd loopfare
cp .env.example .env
npm ci
npm run dev
```

Open `http://localhost:4021`. The readiness endpoint should answer with `{"ok":true}`:

```bash
curl --fail http://localhost:4021/health/ready
```

## 2. Make the CLI available

In a second terminal, from the repository root:

```bash
npm run build -w @loopfare/cli
npm link -w @loopfare/cli
loopfare --version
loopfare set-api http://localhost:4021
```

Every command supports the top-level `--json` option. Put it before the subcommand, for example `loopfare --json projects list`.

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

Use an EVM address that you control. On Base Sepolia it will receive test USDC.

```bash
loopfare projects create \
  --name "Weather API" \
  --slug weather \
  --pay-to 0xYourReceivingAddress \
  --json
```

Copy the returned project `id`.

## 5. Protect an origin

For a public deployment, `--origin` must be an HTTP or HTTPS origin that resolves only to public IP addresses. Loopfare blocks local, private, link-local, metadata, multicast, and reserved addresses.

```bash
loopfare protect \
  --project PROJECT_ID \
  --origin https://api.example.com \
  --path "/v1/*" \
  --methods GET,POST \
  --price '$0.001' \
  --description "Paid weather data" \
  --json
```

The paid URL has this shape:

```text
http://localhost:4021/p/weather/v1/forecast
```

Loopfare preserves the query string, does not follow origin redirects, strips credentials and payment headers, and returns the origin response only after a real payment settles.

## 6. Make a local development call

The example `.env` enables local development payments. Create a disposable wallet and set a daily budget:

```bash
loopfare wallet create --json
loopfare budget set --daily 5 --json
loopfare call http://localhost:4021/p/weather/v1/forecast --dev --json
```

`--dev` sends `LOOPFARE-DEV-PAYMENT: ok`. Production refuses to start when development payments are enabled.

If your test origin runs on localhost, keep `ALLOW_PRIVATE_ORIGINS=true` only in local development. It must be `false` in production.

## 7. Test the x402 challenge

Call the route without `--dev` or a payment signature:

```bash
curl -i http://localhost:4021/p/weather/v1/forecast
```

The response is HTTP `402` and includes the x402 v2 `PAYMENT-REQUIRED` header. A compatible client signs the exact-payment payload and retries with `PAYMENT-SIGNATURE`.

## 8. Make a real Base Sepolia payment

Fund the buyer wallet with Base Sepolia ETH for gas and Base Sepolia USDC. Never fund a generated test wallet with mainnet assets.

```bash
loopfare budget set --daily 1 --json
loopfare call https://YOUR_LOOPFARE_DOMAIN/p/weather/v1/forecast --json
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

## Next steps

- Read the [seller manual](./SELLER_MANUAL.md) before publishing a paid route.
- Read the [buyer manual](./BUYER_MANUAL.md) before funding a wallet.
- Use the [API reference](./API_REFERENCE.md) for direct HTTP integrations.
- Follow the [production checklist](./PRODUCTION.md) before handling real value.
