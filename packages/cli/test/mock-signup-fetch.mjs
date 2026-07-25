const apiKey = `lf_${"a".repeat(48)}`;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (init.method !== "POST" || url.pathname !== "/v1/auth/signup") {
    return new Response(null, { status: 404 });
  }
  const { email } = JSON.parse(String(init.body));
  return Response.json({ id: "acct_first", email, apiKey });
};
