// Read-only, bounded sample. Run behind TLS for non-local use. No request logging/storage.
import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

const secret = process.env.ORIGIN_SECRET;
const routeId = process.env.LOOPFARE_ROUTE_ID;
const challenge = process.env.LOOPFARE_ORIGIN_CHALLENGE;
if (!secret || secret.length < 32 || !routeId || !challenge)
  throw new Error(
    "Set ORIGIN_SECRET (32+ chars), LOOPFARE_ROUTE_ID, and LOOPFARE_ORIGIN_CHALLENGE",
  );
const digest = (value) => createHash("sha256").update(value).digest();

createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const supplied = req.headers["x-loopfare-origin-secret"];
  if (
    typeof supplied !== "string" ||
    !timingSafeEqual(digest(supplied), digest(secret))
  ) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === `/.well-known/loopfare/${routeId}`) {
    res.writeHead(200, { "Content-Type": "text/plain" }).end(challenge);
    return;
  }
  if (url.pathname !== "/v1/analyze") {
    res.writeHead(404).end();
    return;
  }
  const text =
    url.searchParams.get("text") ?? "Loopfare makes API access programmable.";
  if (Buffer.byteLength(text) > 4096) {
    res.writeHead(413).end();
    return;
  }
  res
    .writeHead(200, { "Content-Type": "application/json" })
    .end(
      JSON.stringify({
        characters: [...text].length,
        words: text.trim() ? text.trim().split(/\s+/u).length : 0,
        sha256: digest(text).toString("hex"),
        stored: false,
      }),
    );
}).listen(Number(process.env.PORT ?? 4022), "127.0.0.1");
