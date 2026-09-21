import assert from "node:assert/strict";
globalThis.fetch = async (input, init) => {
  assert.equal(init.redirect, "error");
  const url = new URL(String(input));
  assert.equal(url.origin, "https://onboarding.test");
  const body = init.body ? JSON.parse(init.body) : {};
  if (url.pathname === "/v1/auth/signup")
    return Response.json({
      apiKey: "lf_test_onboarding_secret",
      email: body.email,
    });
  assert.equal(
    new Headers(init.headers).get("authorization"),
    "Bearer lf_test_onboarding_secret",
  );
  if (url.pathname === "/v1/projects")
    return Response.json({ id: "project-123" });
  if (url.pathname === "/v1/projects/project-123/routes") {
    assert.equal(body.methods, "GET,HEAD");
    return Response.json({ route: { id: "route-456" } });
  }
  if (
    url.pathname ===
    "/v1/projects/project-123/routes/route-456/origin-credential"
  ) {
    assert.equal(init.method, "PUT");
    assert.equal(body.secret, "example-secret-" + "x".repeat(32));
    return Response.json({
      challenge: "abc",
      verificationPath: "/.well-known/loopfare/route-456",
    });
  }
  throw new Error(`Unexpected onboarding request: ${url.pathname}`);
};
