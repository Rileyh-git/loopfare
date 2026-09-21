import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("guided setup carries project and route IDs without printing secrets", () => {
  const directory = mkdtempSync(join(tmpdir(), "loopfare-onboarding-"));
  const secret = "example-secret-" + "x".repeat(32);
  const file = join(directory, "origin-secret");
  writeFileSync(file, secret, { mode: 0o600 });
  try {
    const env = {
      ...process.env,
      LOOPFARE_CONFIG_DIR: directory,
      LOOPFARE_API_URL: "https://onboarding.test",
      NODE_OPTIONS: `--import=${fileURLToPath(new URL("./mock-onboarding-fetch.mjs", import.meta.url))}`,
    };
    delete env.LOOPFARE_API_KEY;
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../dist/index.js", import.meta.url)),
        "--json",
        "init",
        "--email",
        "test@example.com",
        "--name",
        "Test",
        "--slug",
        "test",
        "--pay-to",
        "0x" + "1".repeat(40),
        "--origin",
        "https://origin.test",
        "--origin-secret-file",
        file,
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.projectId, "project-123");
    assert.equal(output.routeId, "route-456");
    assert.match(output.next, /verify-origin project-123 route-456/);
    assert.ok(!(result.stdout + result.stderr).includes(secret));
    assert.ok(
      !(result.stdout + result.stderr).includes("lf_test_onboarding_secret"),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
