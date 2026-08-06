const expectedToken = "lm_cli_metrics_read_only_key_1234567890";

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const headers = new Headers(init.headers);
  if (
    url.origin === "https://metrics.test" &&
    url.pathname === "/v1/admin/metrics" &&
    url.searchParams.get("days") === "7" &&
    headers.get("Authorization") === `Bearer ${expectedToken}`
  ) {
    return Response.json({
      window: { days: 7 },
      summary: { signups: 3, requestCount: 42 },
    });
  }
  return Response.json({ error: "unauthorized" }, { status: 401 });
};
