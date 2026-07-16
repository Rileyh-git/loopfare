# Security policy

## Supported version

Only the latest commit on the default branch is supported during the public beta.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting flow for this repository. Do not open a public issue containing exploit details, API keys, wallet private keys, payment signatures, or user data.

Include the affected endpoint or CLI command, expected impact, reproduction steps, and any suggested remediation. Rotate any exposed credential immediately; do not wait for a response.

## Security model

- Loopfare is non-custodial. Seller payments settle to the wallet configured on a project.
- Buyer private keys are stored only in the buyer's local CLI config. The CLI applies mode `0600` to that file and mode `0700` to its directory.
- Seller API keys are shown once and stored server-side as SHA-256 hashes.
- Seller origins are restricted to HTTP(S), resolved before creation and use, and blocked when they target private, loopback, link-local, metadata, multicast, or reserved ranges.
- Daily buyer budgets require a separate secret token and are a compatible-client safety rail, not a wallet-level spending policy.
- Production must run with `LOOPFARE_DEV_MODE=false` and `ALLOW_PRIVATE_ORIGINS=false`.

## Operational response

For a suspected compromise:

1. Disable new signups with `SIGNUP_ENABLED=false`.
2. Rotate affected seller keys with `loopfare rotate-key`.
3. Revoke or move funds from an exposed buyer wallet.
4. Review Railway HTTP and application logs by request ID.
5. Restore the SQLite volume from a known-good backup if data integrity is in doubt.
