# Codebase review implementation status

September 21, 2026. Implementation snapshot for v0.3.0; deployment and registry publication must be verified independently of this checklist.

Rollout update: v0.3.1 is live on Railway; its pre-migration SQLite backup passed integrity and foreign-key checks, live database/payment health checks passed, and read-only metrics preserved the prior records. Node 22 and Node 24 CI both passed after upgrading better-sqlite3 to 12.11.1. npm accepted v0.3.1 with provenance but required processing time before registry installation; the workflow now retries that smoke check. Remaining-acceptance entries below are the original pre-rollout checklist, not a claim that scheduled/off-site backups or human testing are complete.

| Review item | Implemented | Remaining acceptance |
| --- | --- | --- |
| 1. Wallet safety | Explicit replacement, stdin import, corrupt-config rejection, private files, pending-payment guard | Optional OS keychain integration is not implemented |
| 2. Credential scoping | Per-origin profiles, explicit server switching, redirect rejection, budget-token origin checks | Verify the coordinated production CLI/server rollout |
| 3. Origin protection | AES-GCM secret storage, challenge verification, rotation/reverification, header stripping, sample authenticated origin | Provision encryption key; each seller must enforce authentication on every paid endpoint |
| 4. Operator privilege | Dedicated metrics credential; no email-based privilege; reserved signup identities | Deploy updated authorization |
| 5. Budget correctness | Durable atomic-amount reservations, conservative unknown states, midnight-safe release IDs, network/payee/per-call policies | Automated on-chain reconciliation is not implemented; unknown outcomes require authoritative evidence before recovery |
| 6. Paid side effects | Paid writes disabled; durable verified-signature replay claims; queryable seller operations | General paid-write idempotency and compensation remain future work |
| 7. Dependencies | Hono 4.13.8 and fast-uri 3.1.6; refreshed lockfile | Production audit returned zero vulnerabilities at verification time |
| 8. Release | Tag-only workflow, per-ref concurrency, post-publish registry smoke check; local package installed independently | Select a new immutable version/tag, commit/push, publish, verify registry; previous publish job was cancelled before steps ran |
| 9. Onboarding | Guided init, origin verification/rotation commands, demo guide, useful bounded sample, clean JSON | Three unfamiliar developer sessions require real participants |
| 10. Metrics | Expected 402 correction including daily history, verified payer identities, chain/demo/test segments, opt-in CLI IDs, DNT/GPC, allowlisted campaigns, unknown-operation counts | Cross-device/cross-channel cohort attribution is not implemented; historical unknown traffic is not relabeled as people/customers |
| 11. Ownership/recovery | Signed, expiring, domain-bound, single-use budget challenges; token recovery preserves spend | Email account recovery deliberately not claimed; key-only limitation documented |
| 12. History | Project archival, immutable payment account ownership, mainnet-only seller volume | Verify a production migration backup before deployment |
| Operational backlog | Production private-origin rejection, explicit proxy trust, bounded rate maps/network calls, separate payment health, structured warnings, SQLite online backup + restore test, module splits, docs corrections | Verify Railway ingress/scheduled backups and isolated restore; configure the actual alert destination; independent review before mainnet |

## Verification

- Full `npm run check`: typechecks, builds, 30 API tests, 14 CLI tests, Markdown-link checks, and package dry-run pass.
- Extra TypeScript unused-import checks and `git diff --check` pass.
- Production dependency audit: zero reported vulnerabilities.
- Packed CLI installed in a clean temporary directory; version, init/call help, and isolated config smoke checks passed.
- Real x402 middleware exercised against a controlled facilitator, with intercepted origin success, verification/settlement rejection, replay, redirects, oversized responses, and connection failure. No on-chain funds moved.
- SQLite online backup was reopened and compared against WAL-backed account/payment fixture data; overwriting an existing backup was rejected. This is a local drill, not verification of Railway's live backup schedule.

## Rollout decision

Do not repoint the existing v0.2.7 tag. These changes alter the budget setup and route-enablement contracts; coordinate a new CLI release with the server deployment. Keep Base Sepolia and read-only routes. Follow [HARDENING.md](HARDENING.md) for secret provisioning, migration, verification, and operational limitations.
