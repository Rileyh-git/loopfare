import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const home = mkdtempSync(join(tmpdir(), "loopfare-doctor-test-"));
process.env.HOME = home;
delete process.env.EVM_PRIVATE_KEY;
delete process.env.LOOPFARE_PRIVATE_KEY;
delete process.env.LOOPFARE_API_KEY;
delete process.env.LOOPFARE_API_URL;

const { runDoctor } = await import("../dist/doctor.js");

after(() => rmSync(home, { recursive: true, force: true }));

test("doctor reports a reachable Base Sepolia service without exposing secrets", async () => {
  const fakeFetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api")) {
      return new Response(
        JSON.stringify({
          name: "loopfare",
          version: "0.2.7",
          network: "base-sepolia",
          networkCaip2: "eip155:84532",
          protocol: "x402-v2",
          demoEnabled: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.endsWith("/health/ready")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  const report = await runDoctor(fakeFetch, 1_000);
  assert.equal(report.ok, true);
  assert.equal(report.api.network, "base-sepolia");
  assert.equal(report.api.demoEnabled, false);
  assert.equal(report.config.exists, false);
  assert.equal(report.wallet.configured, false);
  assert.ok(report.next.some((step) => step.includes("wallet create")));
});

test("doctor returns actionable guidance when the API is unreachable", async () => {
  const unavailableFetch = async () => {
    throw new TypeError("fetch failed");
  };

  const report = await runDoctor(unavailableFetch, 1_000);
  assert.equal(report.ok, false);
  assert.equal(report.api.reachable, false);
  assert.equal(report.api.ready, false);
  assert.match(report.api.error, /fetch failed/);
  assert.ok(report.next.some((step) => step.includes("Check connectivity")));
});
