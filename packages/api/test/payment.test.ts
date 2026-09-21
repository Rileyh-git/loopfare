import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAgent } from "undici";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const directory = mkdtempSync(join(tmpdir(), "loopfare-protocol-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_PATH: join(directory, "db.sqlite"),
  LOOPFARE_DEV_MODE: "false",
  PUBLIC_URL: "https://loopfare.test",
  FACILITATOR_URL: "https://facilitator.test",
  ORIGIN_ENCRYPTION_KEY: "22".repeat(32),
  ALLOW_PRIVATE_ORIGINS: "false",
  MAX_PROXY_RESPONSE_BYTES: "65536",
});
const { app } = await import("../src/app.js");
const db = await import("../src/db.js");
const origin = await import("../src/origin-security.js");
const credentials = await import("../src/origin-auth.js");
const mock = new MockAgent();
mock.disableNetConnect();
origin.safeProxyDispatcher.dispatch = mock.dispatch.bind(mock);
const originalFetch = globalThis.fetch;
const payer = privateKeyToAccount(generatePrivateKey());
let verifyValid = true,
  settleValid = true,
  settleCalls = 0;
let submitted: Request | undefined;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const path = new URL(String(input)).pathname;
  if (path === "/supported")
    return Response.json({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
      extensions: [],
      signers: {},
    });
  if (path === "/verify")
    return Response.json({
      isValid: verifyValid,
      payer: payer.address,
      ...(!verifyValid ? { invalidReason: "invalid_signature" } : {}),
    });
  if (path === "/settle") {
    settleCalls++;
    return Response.json({
      success: settleValid,
      network: "eip155:84532",
      transaction: "0x" + "1".repeat(64),
      payer: payer.address,
      ...(!settleValid ? { errorReason: "settlement_rejected" } : {}),
    });
  }
  throw new Error(`Unexpected network request: ${path}`);
}) as typeof fetch;
after(async () => {
  globalThis.fetch = originalFetch;
  await mock.close();
  await origin.closeProxyDispatcher();
  db.closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

const account = db.createAccount("protocol@example.com");
const project = db.createProject({
  accountId: account.account.id,
  name: "Protocol",
  slug: "protocol",
  payTo: "0x" + "2".repeat(40),
});
const route = db.createRoute({
  projectId: project.id,
  pathPattern: "/*",
  originUrl: "https://8.8.8.8",
  price: "$0.001",
});
const secret = "test-origin-" + "a".repeat(32);
const challenge = credentials.configureOriginCredential(route.id, secret);

async function buyer(path: string) {
  const client = new x402Client().register(
    "eip155:84532",
    new ExactEvmScheme(payer),
  );
  const local = (async (input: any, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.headers.has("payment-signature")) submitted = request.clone();
    return app.request(request);
  }) as typeof fetch;
  return wrapFetchWithPayment(
    local,
    client,
  )(`https://loopfare.test/p/protocol/${path}`);
}

test("origin ownership verification requires authentication and challenge; secret remains server-side", async () => {
  const pool = mock.get("https://8.8.8.8");
  pool.intercept({ path: challenge.verificationPath }).reply(403, "denied");
  pool
    .intercept({
      path: challenge.verificationPath,
      headers: { "x-loopfare-origin-secret": secret },
    })
    .reply(200, challenge.challenge);
  await credentials.verifyOriginCredential(route.id, route.origin_url);
  assert.equal(credentials.originVerified(route.id), true);
  assert.equal(db.getRouteById(route.id)!.enabled, 1);
});

test("real x402 middleware verifies, proxies, settles, and records authoritative payer", async () => {
  mock
    .get("https://8.8.8.8")
    .intercept({ path: "/ok", headers: { "x-loopfare-origin-secret": secret } })
    .reply(200, { useful: true });
  const response = await buyer("ok");
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok(response.headers.get("payment-response"));
  assert.equal(response.headers.get("x-loopfare-origin-secret"), null);
  assert.equal(
    db.listPayments({ accountId: account.account.id })[0].buyer_hint,
    payer.address.toLowerCase(),
  );
  assert.equal(
    db.getEarnings(project.id).volume_usd,
    0,
    "Sepolia is not mainnet revenue",
  );
  const before = settleCalls;
  assert.equal((await app.request(submitted!.clone())).status, 409);
  assert.equal(
    settleCalls,
    before,
    "replayed signature must not reach settlement",
  );
});

test("verification rejection never calls the origin or settles", async () => {
  verifyValid = false;
  const before = settleCalls;
  const response = await buyer("invalid");
  assert.equal(response.status, 402);
  assert.equal(settleCalls, before);
  verifyValid = true;
});

test("settlement rejection does not create a successful payment record", async () => {
  settleValid = false;
  const before = db.listPayments({ accountId: account.account.id }).length;
  mock
    .get("https://8.8.8.8")
    .intercept({ path: "/reject" })
    .reply(200, { ok: true });
  const response = await buyer("reject");
  assert.equal(response.status, 402);
  assert.equal(
    db.listPayments({ accountId: account.account.id }).length,
    before,
  );
  settleValid = true;
});

test("upstream errors and redirects do not settle", async () => {
  const before = settleCalls;
  mock
    .get("https://8.8.8.8")
    .intercept({ path: "/error" })
    .reply(503, "unavailable");
  assert.equal((await buyer("error")).status, 503);
  mock
    .get("https://8.8.8.8")
    .intercept({ path: "/redirect" })
    .reply(302, "", { headers: { location: "http://127.0.0.1/secret" } });
  assert.equal((await buyer("redirect")).status, 502);
  assert.equal(settleCalls, before);
});

test("oversized and failed upstream streams never settle", async () => {
  const before = settleCalls;
  mock
    .get("https://8.8.8.8")
    .intercept({ path: "/large" })
    .reply(200, "x".repeat(65537));
  assert.equal((await buyer("large")).status, 502);
  mock
    .get("https://8.8.8.8")
    .intercept({ path: "/disconnected" })
    .replyWithError(new Error("connection lost"));
  assert.equal((await buyer("disconnected")).status, 502);
  assert.equal(settleCalls, before);
});
