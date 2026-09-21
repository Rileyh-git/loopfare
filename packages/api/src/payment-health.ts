import { config } from "./config.js";

let cached:
  | { ok: boolean; checkedAt: string; network: string; reason?: string }
  | undefined;
let inFlight: Promise<NonNullable<typeof cached>> | undefined;
export async function paymentHealth() {
  if (cached && Date.now() - Date.parse(cached.checkedAt) < 30_000)
    return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let ok = false;
    try {
      const response = await fetch(
        `${config.facilitatorUrl.replace(/\/$/, "")}/supported`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
          headers: config.facilitatorApiKey
            ? { Authorization: `Bearer ${config.facilitatorApiKey}` }
            : {},
        },
      );
      const reader = response.body?.getReader();
      let body = "";
      try {
        if (reader)
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            body += Buffer.from(part.value).toString("utf8");
            if (body.length > 65536) throw new Error("Too large");
          }
      } finally {
        await reader?.cancel().catch(() => {});
      }
      const data = JSON.parse(body);
      ok =
        response.ok &&
        Array.isArray(data.kinds) &&
        data.kinds.some(
          (kind: { network?: string; scheme?: string; x402Version?: number }) =>
            kind.network === config.networkCaip2 &&
            kind.scheme === "exact" &&
            kind.x402Version === 2,
        );
    } catch {
      /* Never log auth headers or an untrusted facilitator body. */
    }
    cached = {
      ok,
      checkedAt: new Date().toISOString(),
      network: config.networkCaip2,
      ...(!ok ? { reason: "facilitator_unavailable_or_unsupported" } : {}),
    };
    if (!ok)
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "payment_readiness_failed",
          ...cached,
        }),
      );
    return cached;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = undefined;
  }
}
