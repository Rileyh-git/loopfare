import { lookup as lookupCallback } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";
import { config } from "./config.js";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.internal",
]);

/** Normalize and validate a seller-supplied upstream URL. */
export function normalizeOriginUrl(input: string): string {
  if (input.length > 2_048) throw new Error("Origin URL is too long");

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Origin URL is invalid");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Origin URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Origin URL cannot contain credentials");
  }
  if (url.search || url.hash) {
    throw new Error("Origin URL cannot contain a query string or fragment");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new Error("Origin hostname is not allowed");
  }

  url.hostname = hostname;
  return url.toString().replace(/\/$/, "");
}

/**
 * Resolve an origin immediately before use and reject loopback, private, link-local,
 * multicast, documentation, and otherwise non-public addresses.
 */
export async function assertSafeOrigin(input: string): Promise<string> {
  const normalized = normalizeOriginUrl(input);
  if (config.allowPrivateOrigins) return normalized;

  const hostname = new URL(normalized).hostname;
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0) throw new Error("Origin hostname did not resolve");
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Origin must resolve only to public IP addresses");
  }
  return normalized;
}

/**
 * Re-check every DNS answer at the socket connection boundary. The earlier
 * assertSafeOrigin check gives callers a useful validation error; this custom
 * lookup closes the DNS-rebinding window between validation and connect.
 */
export const safeProxyDispatcher = new Agent({
  maxResponseSize: config.maxProxyResponseBytes,
  connect: {
    lookup(hostname, options, callback) {
      lookupCallback(
        hostname,
        { ...options, all: true, order: "verbatim" },
        (error, addresses) => {
          if (error) {
            callback(error, "", 0);
            return;
          }

          const candidates = Array.isArray(addresses) ? addresses : [addresses];
          const allowed = config.allowPrivateOrigins
            ? candidates
            : candidates.filter(({ address }) => !isPrivateAddress(address));
          const family =
            typeof options.family === "number"
              ? options.family
              : options.family === "IPv4"
                ? 4
                : options.family === "IPv6"
                  ? 6
                  : 0;
          const selected = allowed.find((address) => family === 0 || address.family === family);

          if (!selected || allowed.length !== candidates.length) {
            const blocked = Object.assign(
              new Error("Origin DNS resolution included a non-public IP address"),
              { code: "EACCES" },
            );
            callback(blocked, "", 0);
            return;
          }

          callback(null, selected.address, selected.family);
        },
      );
    },
  },
});

export async function closeProxyDispatcher(): Promise<void> {
  await safeProxyDispatcher.close();
}

export function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase().split("%")[0]!;

  if (value.startsWith("::ffff:")) {
    return isPrivateAddress(value.slice("::ffff:".length));
  }

  if (isIP(value) === 4) {
    const parts = value.split(".").map(Number);
    const [a, b, c] = parts;
    if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255)) return true;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a! >= 224
    );
  }

  if (isIP(value) === 6) {
    return (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      /^fe[89ab]/.test(value) ||
      value.startsWith("ff") ||
      value.startsWith("2001:db8:")
    );
  }

  return true;
}
