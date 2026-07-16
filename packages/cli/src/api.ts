import { loadConfig } from "./config.js";

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
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (init.auth !== false && cfg.apiKey) {
    headers.set("Authorization", `Bearer ${cfg.apiKey}`);
  }
  const res = await fetch(`${cfg.apiUrl.replace(/\/$/, "")}${path}`, {
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
