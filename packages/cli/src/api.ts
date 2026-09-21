import { loadConfig } from "./config.js";
import { safeFetch } from "./network.js";
import { LOOPFARE_VERSION } from "./version.js";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const cfg = loadConfig();
  const headers = new Headers(init.headers);
  headers.set("User-Agent", `loopfare-cli/${LOOPFARE_VERSION}`);
  if (cfg.telemetryEnabled && cfg.installId)
    headers.set("X-Loopfare-Install-Id", cfg.installId);
  else headers.set("X-Loopfare-Telemetry", "off");
  if (process.env.LOOPFARE_TEST_TRAFFIC === "1")
    headers.set("X-Loopfare-Traffic", "test");
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (init.auth !== false && cfg.apiKey) {
    headers.set("Authorization", `Bearer ${cfg.apiKey}`);
  }
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("API path must be relative to the configured origin");
  const res = await safeFetch(`${cfg.apiUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  if (!res.ok) {
    throw new ApiError(`API ${res.status} ${path}`, res.status, body);
  }
  return body as T;
}
