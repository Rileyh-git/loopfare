# Production runbook

## Release gates

Run the complete local gate before every deploy:

```bash
npm ci
npm run check
npm audit --omit=dev
```

The production environment must set:

```env
NODE_ENV=production
LOOPFARE_DEV_MODE=false
ALLOW_PRIVATE_ORIGINS=false
SIGNUP_ENABLED=true
LOOPFARE_NETWORK=base-sepolia
FACILITATOR_URL=https://x402.org/facilitator
DATABASE_PATH=/data/loopfare.db
```

Set `PUBLIC_URL` to the final HTTPS domain, or omit it on Railway so `RAILWAY_PUBLIC_DOMAIN` is used automatically. Set `DEMO_PAY_TO` to a wallet controlled by the operator before enabling the paid demo.

## Railway resources

The service requires:

- a generated or custom public domain;
- a persistent volume mounted at `/data`;
- the healthcheck path `/health/ready`;
- one replica while SQLite is the primary store;
- a backup policy for the attached volume.

`railway.toml` and `nixpacks.toml` contain the build, start, healthcheck, and restart configuration.

## Mainnet gate

Do not switch `LOOPFARE_NETWORK` to `base` until all of the following are complete:

- configure an authenticated mainnet-capable facilitator;
- run a low-value mainnet payment and settlement test;
- confirm the receiving wallet and incident-recovery ownership;
- publish final terms, privacy disclosures, refund policy, and support contact;
- define facilitator and gas cost monitoring;
- commission an independent security review of the proxy and payment path.

The public beta should remain on Base Sepolia until this gate is signed off.

## Monitoring

- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`
- Service metadata: `GET /api`
- Application logs are structured JSON and include `requestId`, path, status, and duration.
- HTTP responses include `X-Request-Id` and `X-Response-Time`.

Alert on sustained 5xx responses, restart loops, readiness failures, volume saturation, facilitator errors, and unusual signup volume.

## Rollback

Use Railway's deployment rollback to restore the previous application image. Database migrations in this release are additive and retain legacy columns, so the previous release can still read the same database. Restore a volume backup only when data is corrupted, not for a routine application rollback.
