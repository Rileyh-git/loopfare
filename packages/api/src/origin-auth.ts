import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fetch } from "undici";
import { config } from "./config.js";
import { database } from "./db.js";
import { assertSafeOrigin, safeProxyDispatcher } from "./origin-security.js";

database.exec(`CREATE TABLE IF NOT EXISTS origin_credentials (
  route_id TEXT PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
  encrypted_secret TEXT NOT NULL, challenge TEXT NOT NULL, verified_at TEXT
)`);

function encryptionKey() {
  if (!config.originEncryptionKey)
    throw new Error(
      "Operator must configure ORIGIN_ENCRYPTION_KEY before accepting origin secrets",
    );
  return Buffer.from(config.originEncryptionKey, "hex");
}

export function configureOriginCredential(routeId: string, secret: string) {
  if (secret.length < 32 || secret.length > 512 || /[\r\n]/.test(secret))
    throw new Error(
      "Origin secret must be 32–512 characters without line breaks",
    );
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(routeId));
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const value = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
    "base64",
  );
  const challenge = randomBytes(32).toString("hex");
  database
    .prepare(
      `INSERT INTO origin_credentials VALUES (?, ?, ?, NULL)
    ON CONFLICT(route_id) DO UPDATE SET encrypted_secret=excluded.encrypted_secret, challenge=excluded.challenge, verified_at=NULL`,
    )
    .run(routeId, value, challenge);
  database.prepare("UPDATE routes SET enabled = 0 WHERE id = ?").run(routeId);
  return {
    challenge,
    verificationPath: `/.well-known/loopfare/${routeId}`,
    header: "X-Loopfare-Origin-Secret",
  };
}

export function originCredential(routeId: string): string | undefined {
  const row = database
    .prepare(
      "SELECT encrypted_secret FROM origin_credentials WHERE route_id = ?",
    )
    .get(routeId) as { encrypted_secret: string } | undefined;
  if (!row) return undefined;
  const packed = Buffer.from(row.encrypted_secret, "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    packed.subarray(0, 12),
  );
  cipher.setAAD(Buffer.from(routeId));
  cipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([
    cipher.update(packed.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}

export function originVerified(routeId: string): boolean {
  return Boolean(
    database
      .prepare(
        "SELECT 1 FROM origin_credentials WHERE route_id = ? AND verified_at IS NOT NULL",
      )
      .get(routeId),
  );
}

export function invalidateOriginVerification(routeId: string) {
  database
    .prepare(
      "UPDATE origin_credentials SET verified_at = NULL WHERE route_id = ?",
    )
    .run(routeId);
  database.prepare("UPDATE routes SET enabled = 0 WHERE id = ?").run(routeId);
}

export async function verifyOriginCredential(routeId: string, origin: string) {
  const row = database
    .prepare("SELECT challenge FROM origin_credentials WHERE route_id = ?")
    .get(routeId) as { challenge: string } | undefined;
  if (!row) throw new Error("Configure an origin credential first");
  const target = new URL(
    `/.well-known/loopfare/${routeId}`,
    await assertSafeOrigin(origin),
  );
  if (!config.devMode && target.protocol !== "https:")
    throw new Error("Authenticated origins require HTTPS outside development mode");
  const options = {
    dispatcher: safeProxyDispatcher,
    redirect: "error" as const,
    signal: AbortSignal.timeout(10_000),
  };
  const direct = await fetch(target, options);
  await direct.body?.cancel();
  if (![401, 403].includes(direct.status))
    throw new Error(
      "Origin verification endpoint must reject requests without the secret (401/403)",
    );
  const verified = await fetch(target, {
    ...options,
    headers: { "X-Loopfare-Origin-Secret": originCredential(routeId)! },
  });
  const reader = verified.body?.getReader();
  let text = "";
  if (reader) {
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        text += Buffer.from(part.value).toString("utf8");
        if (text.length > 1024)
          throw new Error("Verification response too large");
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  if (verified.status !== 200 || text.trim() !== row.challenge)
    throw new Error("Origin did not return the expected ownership challenge");
  database.transaction(() => {
    const changed = database
      .prepare(
        "UPDATE origin_credentials SET verified_at = ? WHERE route_id = ? AND challenge = ? AND EXISTS (SELECT 1 FROM routes WHERE id = ? AND origin_url = ?)",
      )
      .run(new Date().toISOString(), routeId, row.challenge, routeId, origin);
    if (!changed.changes)
      throw new Error(
        "Origin configuration changed during verification; retry",
      );
    database.prepare("UPDATE routes SET enabled = 1 WHERE id = ?").run(routeId);
  })();
}
