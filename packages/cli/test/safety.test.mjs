import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";

const directory = mkdtempSync(join(tmpdir(), "loopfare-safety-"));
process.env.LOOPFARE_CONFIG_DIR = directory;
delete process.env.LOOPFARE_API_URL;
delete process.env.LOOPFARE_API_KEY;
const cfg = await import("../dist/config.js");
const net = await import("../dist/network.js");
after(() => rmSync(directory, { recursive: true, force: true }));

test("wallet replacement is explicit and corruption is never overwritten", () => {
  cfg.replaceWallet(generatePrivateKey());
  const original = readFileSync(cfg.configPath(), "utf8");
  assert.throws(() => cfg.replaceWallet(generatePrivateKey()), /Back up/);
  assert.equal(readFileSync(cfg.configPath(), "utf8"), original);
  writeFileSync(cfg.configPath(), "{broken");
  assert.throws(() => cfg.saveConfig({ email: "bad" }), /Invalid config/);
  assert.equal(readFileSync(cfg.configPath(), "utf8"), "{broken");
  writeFileSync(cfg.configPath(), original);
});

test("credentials do not cross origin profiles or environment overrides", () => {
  cfg.saveConfig({
    apiUrl: "https://first.example",
    apiKey: "first-secret",
    budgetToken: "first-budget",
  });
  cfg.saveConfig({ apiUrl: "https://second.example" });
  assert.equal(cfg.loadConfig().apiKey, undefined);
  assert.equal(cfg.loadConfig().budgetToken, undefined);
  cfg.saveConfig({ apiUrl: "https://first.example" });
  assert.equal(cfg.loadConfig().apiKey, "first-secret");
  process.env.LOOPFARE_API_URL = "https://third.example";
  assert.equal(cfg.loadConfig().apiKey, undefined);
  assert.equal(cfg.loadConfig().budgetToken, undefined);
  delete process.env.LOOPFARE_API_URL;
  assert.deepEqual(
    net.budgetHeaders(
      "https://third.example/pay",
      "https://first.example",
      "secret",
    ),
    {},
  );
  assert.deepEqual(
    net.budgetHeaders(
      "https://first.example/pay",
      "https://first.example",
      "secret",
    ),
    { "X-Loopfare-Budget-Token": "secret" },
  );
  assert.throws(() => cfg.validateApiUrl("http://remote.example"), /HTTPS/);
});

test("pending reservations survive a lost response and day rollover", () => {
  const id = cfg.reserveDailySpend(4, 5, "eip155:84532");
  cfg.reconcileDailySpend(id);
  const stored = JSON.parse(readFileSync(cfg.configPath(), "utf8"));
  stored.reservations[id].day = "2000-01-01";
  writeFileSync(cfg.configPath(), JSON.stringify(stored));
  assert.equal(cfg.currentDailySpend(cfg.loadConfig()).spentTodayUsd, 4);
  assert.throws(() => cfg.reserveDailySpend(2, 5), /exceeds/);
  const today = cfg.reserveDailySpend(1, 5);
  cfg.releaseDailySpend(id);
  assert.equal(cfg.currentDailySpend(cfg.loadConfig()).spentTodayUsd, 1);
  cfg.reconcileDailySpend(today, 1);
  assert.throws(() => cfg.releaseDailySpend(today), /cannot be released/);
});

test("network calls disable redirects, use deadlines, and bound bodies", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => {
      assert.equal(init.redirect, "error");
      assert.ok(init.signal);
      return new Response("ok");
    };
    assert.equal(
      await (await net.safeFetch("https://first.example")).text(),
      "ok",
    );
    globalThis.fetch = async () =>
      new Response(new Uint8Array(10 * 1024 * 1024 + 1));
    await assert.rejects(net.safeFetch("https://first.example"), /10 MiB/);
  } finally {
    globalThis.fetch = original;
  }
});
