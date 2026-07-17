import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = join(packageDirectory, "dist", "index.js");
const homes = [];

after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

function temporaryHome() {
  const home = mkdtempSync(join(tmpdir(), "loopfare-cli-test-"));
  homes.push(home);
  return home;
}

function run(args, home = temporaryHome()) {
  const env = { ...process.env, HOME: home };
  delete env.EVM_PRIVATE_KEY;
  delete env.LOOPFARE_PRIVATE_KEY;
  delete env.LOOPFARE_API_KEY;
  delete env.LOOPFARE_API_URL;
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: packageDirectory,
    env,
    encoding: "utf8",
  });
  return { ...result, home };
}

test("prints public CLI version and onboarding help", () => {
  const version = run(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), "0.2.3");

  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(
    help.stdout,
    /doctor \[options\]\s+Check runtime, API, wallet, budget, and config readiness/,
  );
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
