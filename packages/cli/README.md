# `@loopfare/cli`

Loopfare's command-line client lets API sellers create x402-protected routes and lets buyers make budget-aware USDC payments on Base Sepolia or Base.

Loopfare is currently a Base Sepolia public beta. Do not fund a test wallet with mainnet assets.

## Install

Node.js 22 or newer is required. Test the current public release without installing it globally:

```bash
npx --yes @loopfare/cli@latest doctor
```

For repeated use, install the command globally:

```bash
npm install --global @loopfare/cli@latest
loopfare --version
loopfare doctor
```

Run the same npm command to upgrade an existing installation. If macOS or Linux reports `EACCES`, do not use `sudo`; use a Node version manager or configure npm with a user-owned prefix by following the repository [troubleshooting guide](https://github.com/Rileyh-git/loopfare/blob/main/docs/TROUBLESHOOTING.md#npm-global-install-fails-with-eacces). The CLI defaults to the hosted Base Sepolia service at `https://api-production-dd0a0.up.railway.app`; use `loopfare set-api URL` for a local or self-hosted instance.

## Safe first test

These commands do not spend blockchain assets:

```bash
loopfare doctor
loopfare wallet create
loopfare config
```

The generated private key is stored at `~/.loopfare/config.json`, hidden from normal output, and protected with file mode `0600` on POSIX systems. Back up that file securely before funding the address.

## Hosted payment test

After funding a disposable wallet with Base Sepolia USDC, set a budget and call the public `$0.001` demo:

```bash
loopfare budget set --daily 1
loopfare call https://api-production-dd0a0.up.railway.app/demo/v1/fortune
```

For a complete simulated payment, follow the repository [quickstart](https://github.com/Rileyh-git/loopfare/blob/main/docs/QUICKSTART.md). For command details, use `loopfare help COMMAND` or read the [CLI reference](https://github.com/Rileyh-git/loopfare/blob/main/docs/CLI_REFERENCE.md).

## Security

- Use a dedicated, low-balance wallet.
- Set a daily budget before making a real payment.
- Never paste private keys, seller API keys, or budget tokens into issues or chat.
- Base mainnet is not part of the current public beta.

Report vulnerabilities through GitHub private vulnerability reporting as described in the repository's [security policy](https://github.com/Rileyh-git/loopfare/blob/main/SECURITY.md).
