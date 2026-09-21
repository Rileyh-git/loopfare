import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const testDirectory = mkdtempSync(join(tmpdir(), "loopfare-test-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = join(testDirectory, "loopfare.db");
process.env.LOOPFARE_DEV_MODE = "true";
process.env.ALLOW_PRIVATE_ORIGINS = "false";
process.env.PUBLIC_URL = "http://localhost:4021";
process.env.METRICS_API_KEY = "lm_test_metrics_read_only_key_1234567890";
process.env.ORIGIN_ENCRYPTION_KEY = "11".repeat(32);

const { app } = await import("../src/app.js");
const db = await import("../src/db.js");
const originSecurity = await import("../src/origin-security.js");
const docsSite = await import("../src/docs-site.js");
const usage = await import("../src/usage.js");
const x402 = await import("../src/x402.js");

after(() => {
  db.closeDatabase();
  rmSync(testDirectory, { recursive: true, force: true });
});

async function json(response: Response) {
  return (await response.json()) as Record<string, any>;
}

async function signup(email: string) {
  const response = await app.request("/v1/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(response.status, 201);
  return json(response);
}

test("serves the marketing site with security headers", async () => {
  const response = await app.request("/", {
    headers: { "User-Agent": "Mozilla/5.0 Firefox/140.0" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /default-src 'self'/,
  );
  assert.match(response.headers.get("set-cookie") ?? "", /^lf_session=/);
  assert.equal(response.headers.get("cache-control"), "private, no-cache");
  assert.match(await response.text(), /Make every API call pay its fare/);
});

test("serves every public manual as accessible HTML and raw Markdown", async () => {
  const home = await app.request("/docs");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Loopfare documentation/);

  for (const doc of docsSite.publicDocs) {
    const [html, markdown] = await Promise.all([
      app.request(`/docs/${doc.slug}`),
      app.request(`/docs/${doc.slug}.md`),
    ]);
    assert.equal(html.status, 200, `${doc.slug} HTML`);
    assert.match(html.headers.get("content-type") ?? "", /text\/html/);
    assert.match(
      await html.text(),
      new RegExp(doc.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    );
    assert.equal(markdown.status, 200, `${doc.slug} Markdown`);
    assert.match(markdown.headers.get("content-type") ?? "", /text\/markdown/);
    assert.match(await markdown.text(), /^# /);
  }

  const missing = await app.request("/docs/does-not-exist");
  assert.equal(missing.status, 404);
  assert.equal((await json(missing)).error, "doc_not_found");
});

test("reports liveness and database readiness", async () => {
  const [metadata, health, ready] = await Promise.all([
    app.request("/api"),
    app.request("/health"),
    app.request("/health/ready"),
  ]);
  assert.equal(metadata.status, 200);
  const service = await json(metadata);
  assert.equal(service.name, "loopfare");
  assert.equal(service.version, "0.3.0");
  assert.equal(service.network, "base-sepolia");
  assert.equal(health.status, 200);
  const healthReport = await json(health);
  assert.equal(healthReport.ok, true);
  assert.equal(healthReport.version, "0.3.0");
  assert.equal(ready.status, 200);
});

test("stores hashed API keys and invalidates an old key on rotation", async () => {
  const account = await signup("owner@example.com");
  assert.match(account.apiKey, /^lf_/);

  const before = await app.request("/v1/auth/me", {
    headers: { Authorization: `Bearer ${account.apiKey}` },
  });
  assert.equal(before.status, 200);

  const rotated = await app.request("/v1/auth/rotate-key", {
    method: "POST",
    headers: { Authorization: `Bearer ${account.apiKey}` },
  });
  assert.equal(rotated.status, 200);
  const replacement = await json(rotated);
  assert.notEqual(replacement.apiKey, account.apiKey);

  const oldKey = await app.request("/v1/auth/me", {
    headers: { Authorization: `Bearer ${account.apiKey}` },
  });
  const newKey = await app.request("/v1/auth/me", {
    headers: { Authorization: `Bearer ${replacement.apiKey}` },
  });
  assert.equal(oldKey.status, 401);
  assert.equal(newKey.status, 200);
});

test("returns a consistent JSON envelope for authentication errors", async () => {
  const response = await app.request("/v1/auth/me");
  const body = await json(response);
  assert.equal(response.status, 401);
  assert.equal(body.error, "unauthorized");
  assert.match(body.message, /Bearer API key/);
  assert.equal(typeof body.requestId, "string");
});

test("scopes global payment history to the authenticated account", async () => {
  const first = await signup("first@example.com");
  const second = await signup("second@example.com");
  const project = db.createProject({
    accountId: first.id,
    name: "First API",
    slug: "first-api",
    payTo: "0x1111111111111111111111111111111111111111",
  });
  db.recordPayment({
    projectId: project.id,
    method: "GET",
    path: "/p/first-api/data",
    price: "$0.01",
    status: "settled",
  });

  const firstHistory = await app.request("/v1/payments", {
    headers: { Authorization: `Bearer ${first.apiKey}` },
  });
  const secondHistory = await app.request("/v1/payments", {
    headers: { Authorization: `Bearer ${second.apiKey}` },
  });
  assert.equal((await json(firstHistory)).payments.length, 1);
  assert.equal((await json(secondHistory)).payments.length, 0);
});

test("rejects private and metadata origins before creating a route", async () => {
  const account = db.createAccount("ssrf@example.com");
  const project = db.createProject({
    accountId: account.account.id,
    name: "Unsafe API",
    slug: "unsafe-api",
    payTo: "0x2222222222222222222222222222222222222222",
  });
  const response = await app.request(`/v1/projects/${project.id}/routes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pathPattern: "/*",
      originUrl: "http://169.254.169.254/latest/meta-data",
      price: "$0.01",
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(db.listRoutes(project.id).length, 0);
});

test("protects buyer budgets with a separate secret token", async () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const wallet = signer.address;
  const token = "lb_abcdefghijklmnopqrstuvwxyz1234567890";
  const challengeResponse = await app.request("/v1/buyer/budget/challenge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Loopfare-Budget-Token": token,
    },
    body: JSON.stringify({ walletAddress: wallet, dailyLimitUsd: 5 }),
  });
  const challenge = await json(challengeResponse);
  const signature = await signer.signMessage({ message: challenge.message });
  const created = await app.request("/v1/buyer/budget", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Loopfare-Budget-Token": token,
    },
    body: JSON.stringify({
      walletAddress: wallet,
      dailyLimitUsd: 5,
      nonce: challenge.nonce,
      signature,
    }),
  });
  assert.equal(created.status, 200);

  const denied = await app.request(`/v1/buyer/budget/${wallet}`, {
    headers: { "X-Loopfare-Budget-Token": "lb_wrong_wrong_wrong_wrong_wrong" },
  });
  const allowed = await app.request(`/v1/buyer/budget/${wallet}`, {
    headers: { "X-Loopfare-Budget-Token": token },
  });
  assert.equal(denied.status, 403);
  assert.equal(allowed.status, 200);
  assert.equal((await json(allowed)).budget.dailyLimitUsd, 5);
});

test("atomically reserves and refunds compatible buyer budget spend", () => {
  const wallet = "0x4444444444444444444444444444444444444444";
  const token = "lb_reservation_test_token_abcdefghijklmnopqrstuvwxyz";
  assert.ok(db.setBudget(wallet, 5, token));
  const reservation = db.trySpendBudget(wallet, token, 4);
  assert.equal(reservation.ok, true);
  assert.equal(db.trySpendBudget(wallet, token, 2).ok, false);
  assert.equal(
    db.refundBudgetSpend(wallet, token, reservation.reservationId!),
    true,
  );
  assert.equal(db.trySpendBudget(wallet, token, 2).ok, true);
});

test("supports local dev payments without contacting a facilitator", async () => {
  const response = await app.request("/demo/v1/fortune", {
    headers: { "LOOPFARE-DEV-PAYMENT": "ok" },
  });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).charged, "$0.001");
});

test("publishes canonical public URLs in x402 payment requirements", () => {
  const demoRoutes = x402.buildDemoPaymentRoutes() as Record<
    string,
    { resource?: string }
  >;
  assert.equal(
    demoRoutes["GET /demo/v1/fortune"]?.resource,
    "http://localhost:4021/demo/v1/fortune",
  );

  const resource = x402.publicResourceUrl(
    "/p/weather/current",
    "?units=metric",
  );
  const proxyRoutes = x402.buildRoutePaymentRoutes({
    method: "GET",
    path: "/p/weather/current",
    resource,
    price: "$0.001",
    payTo: "0x1111111111111111111111111111111111111111",
    description: "Weather",
  }) as Record<string, { resource?: string }>;
  assert.equal(
    proxyRoutes["GET /p/weather/current"]?.resource,
    "http://localhost:4021/p/weather/current?units=metric",
  );
});

test("validates prices, methods, paths, and IP ranges", () => {
  assert.equal(db.normalizePrice("0.001"), "$0.001");
  assert.throws(() => db.normalizePrice("free"));
  assert.equal(db.normalizeMethods("get, post,GET"), "GET,POST");
  assert.throws(() => db.normalizeMethods("TRACE"));
  assert.equal(db.matchPath("/v1/*", "/v1/weather"), true);
  assert.equal(db.matchPath("/v1/:id", "/v1/42"), true);
  assert.equal(db.matchPath("/v1/:id", "/v1/42/more"), false);
  assert.equal(originSecurity.isPrivateAddress("127.0.0.1"), true);
  assert.equal(originSecurity.isPrivateAddress("10.0.0.1"), true);
  assert.equal(originSecurity.isPrivateAddress("8.8.8.8"), false);
  assert.throws(() =>
    originSecurity.normalizeOriginUrl("http://localhost:3000"),
  );
});

test("routes a project base URL through the paid proxy handler", async () => {
  const response = await app.request("/p/missing-project");
  assert.equal(response.status, 404);
  assert.equal((await json(response)).error, "route_not_found");
});

test("tracks first-party usage without counting bots or health checks", async () => {
  const before = usage.getUsageMetrics(1);
  const visitorIp = "203.0.113.42";
  const first = await app.request("/", {
    headers: {
      "User-Agent": "Mozilla/5.0 Firefox/140.0",
      "X-Forwarded-For": visitorIp,
      Referer: "https://example.com/campaign?secret=do-not-store",
    },
  });
  const cookie = first.headers.get("set-cookie")?.split(";", 1)[0];
  assert.match(cookie ?? "", /^lf_session=/);

  const second = await app.request("/docs", {
    headers: {
      Cookie: cookie!,
      "User-Agent": "Mozilla/5.0 Firefox/140.0",
      "X-Forwarded-For": visitorIp,
    },
  });
  assert.equal(second.status, 200);

  const afterVisitor = usage.getUsageMetrics(1);
  assert.equal(
    afterVisitor.summary.uniqueVisitors,
    before.summary.uniqueVisitors + 1,
  );

  const beforeBot = afterVisitor.dataQuality.botsFiltered;
  await app.request("/", {
    headers: { "User-Agent": "Googlebot/2.1" },
  });
  const afterBot = usage.getUsageMetrics(1);
  assert.equal(
    afterBot.summary.uniqueVisitors,
    afterVisitor.summary.uniqueVisitors,
  );
  assert.equal(afterBot.dataQuality.botsFiltered, beforeBot + 1);

  const beforeHealthRequests = afterBot.summary.requestCount;
  await app.request("/health/ready");
  assert.equal(
    usage.getUsageMetrics(1).summary.requestCount,
    beforeHealthRequests,
  );

  const wallet = "0x5555555555555555555555555555555555555555";
  const walletHash = usage.hashUsageIdentifier("wallet", wallet);
  assert.notEqual(walletHash, wallet);
  assert.equal(walletHash, usage.hashUsageIdentifier("wallet", wallet));
  assert.equal(
    usage.sanitizeReferrer("https://example.com/campaign?secret=do-not-store"),
    "https://example.com/campaign",
  );
  assert.equal(
    usage.normalizeUsageRoute(`/v1/buyer/budget/${wallet}`),
    "/v1/buyer/budget/:wallet",
  );
  const malformedCookie = await app.request("/", {
    headers: {
      Cookie: "lf_session=%ZZ",
      "User-Agent": "Mozilla/5.0 Firefox/140.0",
    },
  });
  assert.equal(malformedCookie.status, 200);
  assert.match(malformedCookie.headers.get("set-cookie") ?? "", /^lf_session=/);

  const returningSession = usage.hashUsageIdentifier(
    "session",
    "returning-test-session",
  );
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  usage.recordUsageEvent({
    eventType: "page_view",
    occurredAt: yesterday,
    route: "/",
    sessionId: returningSession,
    userAgentCategory: "desktop_browser",
  });
  usage.recordUsageEvent({
    eventType: "page_view",
    route: "/",
    sessionId: returningSession,
    userAgentCategory: "desktop_browser",
  });
  assert.ok(usage.getUsageMetrics(1).summary.returningVisitors >= 1);
});

test("exposes owner-only aggregate metrics and funnel data", async () => {
  const normal = db.createAccount("metrics-reader@example.com");
  const denied = await app.request("/v1/admin/metrics", {
    headers: { Authorization: `Bearer ${normal.apiKey}` },
  });
  assert.equal(denied.status, 403);

  const missing = await app.request("/v1/admin/metrics");
  assert.equal(missing.status, 401);

  const dedicated = await app.request("/v1/admin/metrics?days=7", {
    headers: { Authorization: `Bearer ${process.env.METRICS_API_KEY}` },
  });
  assert.equal(dedicated.status, 200);
  assert.equal((await json(dedicated)).window.days, 7);

  const cannotActAsSeller = await app.request("/v1/auth/me", {
    headers: { Authorization: `Bearer ${process.env.METRICS_API_KEY}` },
  });
  assert.equal(cannotActAsSeller.status, 401);

  const owner = db.createAccount(
    "owner@loopfare.local",
    "lf_owner_metrics_test_key_1234567890",
  );
  const response = await app.request("/v1/admin/metrics?days=30", {
    headers: { Authorization: `Bearer ${process.env.METRICS_API_KEY}` },
  });
  assert.equal(response.status, 200);
  const metrics = await json(response);
  assert.equal(metrics.window.days, 30);
  assert.ok(metrics.summary.requestCount > 0);
  assert.ok(metrics.summary.signups > 0);
  assert.ok(metrics.summary.paymentsSettled > 0);
  assert.ok(metrics.summary.devPaymentsSettled > 0);
  assert.ok(metrics.summary.demoPaymentsSettled > 0);
  assert.ok(Array.isArray(metrics.daily));
  assert.ok(Array.isArray(metrics.topRoutes));
  assert.equal(metrics.dataQuality.rawIpAddressesStored, false);
  assert.equal(metrics.dataQuality.rawUserAgentsStored, false);
  assert.equal(metrics.dataQuality.healthAndAssetRequestsExcluded, true);

  const invalid = await app.request("/v1/admin/metrics?days=0", {
    headers: { Authorization: `Bearer ${process.env.METRICS_API_KEY}` },
  });
  assert.equal(invalid.status, 400);
  const impersonation = await app.request("/v1/admin/metrics", {
    headers: { Authorization: `Bearer ${owner.apiKey}` },
  });
  assert.equal(impersonation.status, 403);
});

test("archives projects without losing account payment history", () => {
  const account = db.createAccount("archive@example.com");
  const project = db.createProject({
    accountId: account.account.id,
    name: "Archive",
    slug: "archive",
    payTo: "0x" + "1".repeat(40),
  });
  const payment = db.recordPayment({
    projectId: project.id,
    method: "GET",
    path: "/p/archive/test",
    price: "$0.01",
    status: "settled",
  });
  db.deleteProject(project.id);
  assert.equal(db.getProjectBySlug(project.slug), undefined);
  assert.equal(
    db.listPayments({ accountId: account.account.id })[0].id,
    payment.id,
  );
});

test("reservation refunds use identity and do not affect another day's spend", () => {
  const wallet = "0x" + "8".repeat(40),
    token = "lb_midnight_abcdefghijklmnopqrstuvwxyz";
  db.setBudget(wallet, 5, token);
  const old = db.trySpendBudget(wallet, token, 2).reservationId!;
  db.database
    .prepare(
      "UPDATE budget_reservations SET day = '2000-01-01', state = 'unknown' WHERE id = ?",
    )
    .run(old);
  assert.equal(db.getBudgetForToken(wallet, token)!.spent_today_usd, 2);
  const current = db.trySpendBudget(wallet, token, 1).reservationId!;
  assert.ok(db.refundBudgetSpend(wallet, token, old));
  assert.equal(db.getBudgetForToken(wallet, token)!.spent_today_usd, 1);
  assert.equal(db.refundBudgetSpend(wallet, token, old), false);
  db.finishBudgetReservation(current, "settled");
  assert.equal(db.refundBudgetSpend(wallet, token, current), false);
});

test("origin secrets are encrypted and credential rotation disables the route", async () => {
  const originAuth = await import("../src/origin-auth.js");
  const owner = db.createAccount("origin-secret@example.com");
  const project = db.createProject({
    accountId: owner.account.id,
    name: "Origin",
    slug: "origin",
    payTo: "0x" + "1".repeat(40),
  });
  const route = db.createRoute({
    projectId: project.id,
    pathPattern: "/*",
    originUrl: "https://example.com",
    price: "$0.01",
  });
  const secret = "origin-private-secret-" + "a".repeat(32);
  const challenge = originAuth.configureOriginCredential(route.id, secret);
  assert.equal(originAuth.originCredential(route.id), secret);
  assert.equal(originAuth.originVerified(route.id), false);
  assert.equal(db.getRouteById(route.id)!.enabled, 0);
  assert.doesNotMatch(
    JSON.stringify(db.listRoutes(project.id)),
    /encrypted_secret|origin-private/,
  );
  const stored = db.database
    .prepare("SELECT encrypted_secret FROM origin_credentials WHERE route_id=?")
    .get(route.id) as { encrypted_secret: string };
  assert.ok(!stored.encrypted_secret.includes(secret));
  const rotated = originAuth.configureOriginCredential(
    route.id,
    "b".repeat(40),
  );
  assert.notEqual(rotated.challenge, challenge.challenge);
  assert.equal(originAuth.originCredential(route.id), "b".repeat(40));
});

test("signed budget challenges cannot be replayed or reassigned", async () => {
  const { budgetChallenge, authorizeBudget } = await import(
    "../src/budget-ownership.js"
  );
  const signer = privateKeyToAccount(generatePrivateKey());
  const token = "lb_signed_budget_abcdefghijklmnopqrstuvwxyz";
  const challenge = budgetChallenge(signer.address, 5, token);
  const signature = await signer.signMessage({ message: challenge.message });
  assert.equal(
    await authorizeBudget(signer.address, 6, token, challenge.nonce, signature),
    undefined,
  );
  assert.ok(
    await authorizeBudget(signer.address, 5, token, challenge.nonce, signature),
  );
  assert.equal(
    await authorizeBudget(signer.address, 5, token, challenge.nonce, signature),
    undefined,
  );
  const replacement = token + "_rotated";
  const recovery = budgetChallenge(signer.address, 5, replacement);
  assert.ok(
    await authorizeBudget(
      signer.address,
      5,
      replacement,
      recovery.nonce,
      await signer.signMessage({ message: recovery.message }),
    ),
  );
  assert.equal(db.getBudgetForToken(signer.address, token), undefined);
  assert.ok(db.getBudgetForToken(signer.address, replacement));
});

test("honors first-party telemetry opt-out", () => {
  const context = usage.createRequestUsageContext({
    requestId: "optout",
    path: "/",
    headers: new Headers({ "user-agent": "Mozilla/5.0", DNT: "1" }),
  });
  assert.equal(context.excluded, true);
  assert.equal(context.sessionCookie, null);
});

test("expected payment challenges are not service errors", async () => {
  const before = usage.getUsageMetrics().summary.errorCount;
  const response = await app.request("/demo/v1/fortune");
  assert.equal(response.status, 402);
  assert.equal(usage.getUsageMetrics().summary.errorCount, before);
  usage.recordUsageEvent({
    eventType: "request_completed",
    route: "/p/example/x",
    statusCode: 402,
    metadata: { outcome: "payment_denied" },
  });
  assert.equal(usage.getUsageMetrics().summary.errorCount, before + 1);
});

test("daily increments preserve the same challenge and testnet-volume semantics", () => {
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const occurredAt = `${day}T12:00:00.000Z`;
  const baseline = db.database.prepare("SELECT error_count, revenue_usd FROM usage_daily WHERE day=?").get(day) as { error_count: number; revenue_usd: number } | undefined;
  usage.recordUsageEvent({ occurredAt, eventType: "request_completed", route: "/demo/v1/fortune", statusCode: 402, metadata: { outcome: "expected_challenge" } });
  usage.recordUsageEvent({ occurredAt, eventType: "payment_settled", route: "/p/test/value", amountUsd: 5, metadata: { network: "eip155:84532", test: false } });
  const current = db.database.prepare("SELECT error_count, revenue_usd FROM usage_daily WHERE day=?").get(day) as { error_count: number; revenue_usd: number };
  assert.equal(current.error_count, baseline?.error_count ?? 0);
  assert.equal(current.revenue_usd, baseline?.revenue_usd ?? 0);
});
