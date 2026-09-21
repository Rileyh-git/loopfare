/** No automatic redirects or retries: credentials and signed payments stay on the chosen URL. */
export async function safeFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(30_000);
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  const response = await fetch(input, {
    ...init,
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 10 * 1024 * 1024)
        throw new Error("Response exceeds 10 MiB limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function budgetHeaders(
  url: string,
  apiUrl: string,
  token?: string,
): Record<string, string> {
  return token && new URL(url).origin === new URL(apiUrl).origin
    ? { "X-Loopfare-Budget-Token": token }
    : {};
}
