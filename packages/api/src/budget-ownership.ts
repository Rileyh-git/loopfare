import { createHash, randomBytes } from "node:crypto";
import { verifyMessage } from "viem";
import { database, setBudget } from "./db.js";
import { config } from "./config.js";

database.exec(`CREATE TABLE IF NOT EXISTS budget_nonces (
  nonce TEXT PRIMARY KEY, wallet TEXT NOT NULL, token_hash TEXT NOT NULL,
  daily_limit REAL NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL
)`);
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function budgetChallenge(wallet: string, daily: number, token: string) {
  database
    .prepare("DELETE FROM budget_nonces WHERE expires_at < ?")
    .run(Date.now());
  const count = database
    .prepare("SELECT COUNT(*) AS n FROM budget_nonces")
    .get() as { n: number };
  if (count.n >= 10_000)
    throw new Error("Too many pending ownership challenges");
  const nonce = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 5 * 60_000;
  const message = `Loopfare budget authorization\nOrigin: ${new URL(config.publicUrl).origin}\nWallet: ${wallet.toLowerCase()}\nDaily USDC limit: ${daily}\nToken SHA256: ${hash(token)}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\nThis rotates the server budget credential, not your wallet key.`;
  database
    .prepare("INSERT INTO budget_nonces VALUES (?, ?, ?, ?, ?, ?)")
    .run(nonce, wallet.toLowerCase(), hash(token), daily, message, expiresAt);
  return { nonce, message, expiresAt };
}

export async function authorizeBudget(
  wallet: string,
  daily: number,
  token: string,
  nonce: string,
  signature: `0x${string}`,
) {
  const row = database
    .prepare("SELECT * FROM budget_nonces WHERE nonce = ?")
    .get(nonce) as
    | {
        wallet: string;
        token_hash: string;
        daily_limit: number;
        message: string;
        expires_at: number;
      }
    | undefined;
  if (
    !row ||
    row.wallet !== wallet.toLowerCase() ||
    row.token_hash !== hash(token) ||
    row.daily_limit !== daily ||
    row.expires_at <= Date.now()
  )
    return undefined;
  if (
    !(await verifyMessage({
      address: wallet as `0x${string}`,
      message: row.message,
      signature,
    }))
  )
    return undefined;
  return database.transaction(() => {
    if (
      !database
        .prepare("DELETE FROM budget_nonces WHERE nonce = ? AND expires_at > ?")
        .run(nonce, Date.now()).changes
    )
      return undefined;
    // Only a verified wallet controller can rotate a claimed or lost token.
    database
      .prepare(
        "UPDATE buyer_budgets SET access_token_hash = ? WHERE wallet_address = ?",
      )
      .run(hash(token), wallet.toLowerCase());
    return setBudget(wallet, daily, token);
  })();
}
