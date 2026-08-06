import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderSignupWelcome, stripAnsi } from "../dist/brand.js";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = join(packageDirectory, "dist", "index.js");
const signupFetchMock = join(packageDirectory, "test", "mock-signup-fetch.mjs");
const metricsFetchMock = join(packageDirectory, "test", "mock-metrics-fetch.mjs");
const homes = [];

after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

function temporaryHome() {
  const home = mkdtempSync(join(tmpdir(), "loopfare-cli-test-"));
  homes.push(home);
  return home;
}

function environment(home, overrides = {}) {
  const env = { ...process.env, HOME: home };
  delete env.EVM_PRIVATE_KEY;
  delete env.LOOPFARE_PRIVATE_KEY;
  delete env.LOOPFARE_API_KEY;
  delete env.LOOPFARE_API_URL;
  delete env.LOOPFARE_METRICS_API_KEY;
  delete env.METRICS_API_KEY;
  return { ...env, ...overrides };
}

function run(args, home = temporaryHome(), overrides = {}) {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: packageDirectory,
    env: environment(home, overrides),
    encoding: "utf8",
  });
  return { ...result, home };
}

test("prints public CLI version and onboarding help", () => {
  const version = run(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), "0.2.7");

  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(
    help.stdout,
    /doctor \[options\]\s+Check runtime, API, wallet, budget, and config readiness/,
  );
  assert.match(help.stdout, /metrics \[options\]\s+Show read-only owner usage metrics/);
});

test("reads owner metrics with a dedicated environment credential", () => {
  const token = "lm_cli_metrics_read_only_key_1234567890";
  const result = run(["--json", "metrics", "--days", "7"], temporaryHome(), {
    LOOPFARE_METRICS_API_KEY: token,
    LOOPFARE_API_URL: "https://metrics.test",
    NODE_OPTIONS: `--import=${metricsFetchMock}`,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.window.days, 7);
  assert.equal(output.summary.signups, 3);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(token));
});

test("requires an environment credential for owner metrics", () => {
  const result = run(["--json", "metrics"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /LOOPFARE_METRICS_API_KEY or METRICS_API_KEY/);
});

test("uses the hosted beta by default without creating a config file", () => {
  const result = run(["--json", "config"]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.apiUrl, "https://api-production-dd0a0.up.railway.app");
  assert.equal(output.hasPrivateKey, false);
});

test("creates a wallet without printing its private key and locks down storage", () => {
  const home = temporaryHome();
  const created = run(["--json", "wallet", "create"], home);
  assert.equal(created.status, 0, created.stderr);
  const output = JSON.parse(created.stdout);
  assert.match(output.address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal("privateKey" in output, false);

  const directory = join(home, ".loopfare");
  const file = join(directory, "config.json");
  const stored = JSON.parse(readFileSync(file, "utf8"));
  assert.match(stored.privateKey, /^0x[0-9a-fA-F]{64}$/);
  if (process.platform !== "win32") {
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }

  const shown = run(["--json", "wallet", "show"], home);
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(JSON.parse(shown.stdout).address, output.address);
});

test("renders the signup wordmark responsively and only adds color when requested", () => {
  const signup = {
    accountId: "acct_123",
    email: "seller@example.com",
    storedAt: "/Users/test/.loopfare/config.json",
  };
  const wide = renderSignupWelcome(signup, {
    color: false,
    columns: 80,
    home: "/Users/test",
  });
  assert.match(wide, /████/);
  assert.match(wide, /░░/);
  assert.match(wide, /MAKE EVERY API CALL PAY ITS FARE/);
  assert.match(wide, /Account ready\s+seller@example\.com/);
  assert.match(wide, /API key saved\s+~\/\.loopfare\/config\.json/);
  assert.doesNotMatch(wide, /\u001B\[/);

  const colored = renderSignupWelcome(signup, {
    color: true,
    columns: 80,
    home: "/Users/test",
  });
  assert.match(colored, /\u001B\[38;2;200;255;104m/);
  assert.equal(stripAnsi(colored), wide);

  const narrow = renderSignupWelcome(signup, {
    color: false,
    columns: 40,
    home: "/Users/test",
  });
  assert.match(narrow, /LOOPFARE/);
  assert.doesNotMatch(narrow, /████/);
  assert.ok(narrow.split("\n").every((line) => [...line].length <= 40));
});

test("shows the branded first signup while preserving clean JSON output", () => {
  const apiKey = `lf_${"a".repeat(48)}`;
  const mockEnvironment = {
    LOOPFARE_API_URL: "https://mock.loopfare.test",
    NODE_OPTIONS: `--import=${signupFetchMock}`,
  };
  const humanHome = temporaryHome();
  const human = run(
    ["signup", "--email", "human@example.com"],
    humanHome,
    mockEnvironment,
  );
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /████/);
  assert.match(human.stdout, /Account ready\s+human@example\.com/);
  assert.doesNotMatch(human.stdout, new RegExp(apiKey));
  const stored = JSON.parse(
    readFileSync(join(humanHome, ".loopfare", "config.json"), "utf8"),
  );
  assert.equal(stored.apiKey, apiKey);

  const json = run(
    ["--json", "signup", "--email", "json@example.com"],
    temporaryHome(),
    mockEnvironment,
  );
  assert.equal(json.status, 0, json.stderr);
  const output = JSON.parse(json.stdout);
  assert.equal(output.id, "acct_first");
  assert.equal(output.email, "json@example.com");
  assert.equal(output.apiKey, apiKey);
  assert.doesNotMatch(json.stdout, /████/);
});
