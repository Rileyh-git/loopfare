import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { config } from "./config.js";
import type { AuthEnv } from "./types.js";
export function rateLimit(options: {
  limit: number;
  windowMs: number;
}): MiddlewareHandler<AuthEnv> {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const timestamp = Date.now();
    const key = clientIdentifier(c);
    if (!buckets.has(key) && buckets.size >= 10_000) {
      for (const [bucketKey, value] of buckets)
        if (value.resetAt <= timestamp) buckets.delete(bucketKey);
      if (buckets.size >= 10_000)
        return c.json({ error: "rate_limit_capacity" }, 429);
    }
    const current = buckets.get(key);
    const bucket =
      !current || current.resetAt <= timestamp
        ? { count: 0, resetAt: timestamp + options.windowMs }
        : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    c.header("RateLimit-Limit", String(options.limit));
    c.header(
      "RateLimit-Remaining",
      String(Math.max(0, options.limit - bucket.count)),
    );
    c.header("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > options.limit) {
      c.header(
        "Retry-After",
        String(Math.ceil((bucket.resetAt - timestamp) / 1000)),
      );
      return c.json(
        { error: "rate_limited", message: "Too many requests" },
        429,
      );
    }
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= timestamp) buckets.delete(bucketKey);
      }
    }
    await next();
  };
}

function clientIdentifier(c: Context) {
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    /* In-process tests have no socket. */
  }
  return (
    (config.trustedClientIpHeader
      ? c.req.header(config.trustedClientIpHeader)
      : undefined) ||
    peer ||
    "unknown"
  );
}
