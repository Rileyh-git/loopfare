import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { config } from "./config.js";
import { getAccountByApiKey } from "./db.js";
import type { AuthEnv } from "./types.js";
export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) throw new HTTPException(401, { message: "Missing Bearer API key" });
  const account = getAccountByApiKey(key);
  if (!account) throw new HTTPException(401, { message: "Invalid API key" });
  c.set("accountId", account.id);
  c.set("email", account.email);
  await next();
};

function securelyMatchesToken(candidate: string, expected: string): boolean {
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export const requireMetricsAuth: MiddlewareHandler<AuthEnv> = async (
  c,
  next,
) => {
  const header = c.req.header("Authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key)
    throw new HTTPException(401, { message: "Missing Bearer metrics key" });

  if (config.metricsApiKey && securelyMatchesToken(key, config.metricsApiKey)) {
    await next();
    return;
  }

  const account = getAccountByApiKey(key);
  if (!account)
    throw new HTTPException(401, { message: "Invalid metrics key" });
  throw new HTTPException(403, {
    message: "A dedicated metrics credential is required",
  });
};
