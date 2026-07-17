import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const testDirectory = mkdtempSync(join(tmpdir(), "loopfare-test-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = join(testDirectory, "loopfare.db");
process.env.LOOPFARE_DEV_MODE = "true";
process.env.ALLOW_PRIVATE_ORIGINS = "false";
process.env.PUBLIC_URL = "http://localhost:4021";

const { app } = await import("../src/app.js");
const db = await import("../src/db.js");
const originSecurity = await import("../src/origin-security.js");
const docsSite = await import("../src/docs-site.js");

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
  const response = await app.request("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
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
    assert.match(await html.text(), new RegExp(doc.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
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
  assert.equal(service.version, "0.2.4");
  assert.equal(service.network, "base-sepolia");
  assert.equal(health.status, 200);
  const healthReport = await json(health);
  assert.equal(healthReport.ok, true);
  assert.equal(healthReport.version, "0.2.4");
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
  const wallet = "0x3333333333333333333333333333333333333333";
  const token = "lb_abcdefghijklmnopqrstuvwxyz1234567890";
  const created = await app.request("/v1/buyer/budget", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Loopfare-Budget-Token": token,
    },
    body: JSON.stringify({ walletAddress: wallet, dailyLimitUsd: 5 }),
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
  assert.equal(db.trySpendBudget(wallet, token, 4).ok, true);
  assert.equal(db.trySpendBudget(wallet, token, 2).ok, false);
  assert.equal(db.refundBudgetSpend(wallet, token, 4), true);
  assert.equal(db.trySpendBudget(wallet, token, 2).ok, true);
});

test("supports local dev payments without contacting a facilitator", async () => {
  const response = await app.request("/demo/v1/fortune", {
    headers: { "LOOPFARE-DEV-PAYMENT": "ok" },
  });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).charged, "$0.001");
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
  assert.throws(() => originSecurity.normalizeOriginUrl("http://localhost:3000"));
});

test("routes a project base URL through the paid proxy handler", async () => {
  const response = await app.request("/p/missing-project");
  assert.equal(response.status, 404);
  assert.equal((await json(response)).error, "route_not_found");
});
