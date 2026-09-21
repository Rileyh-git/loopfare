import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("dotenv stays quiet and Zod preserves false-valued configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "loopfare-env-test-"));
  try {
    writeFileSync(
      join(directory, ".env"),
      "SIGNUP_ENABLED=false\nLOOPFARE_DEV_MODE=false\nALLOW_PRIVATE_ORIGINS=false\nUSAGE_TRACKING_ENABLED=false\n",
    );
    const env = {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_PATH: join(directory, "test.db"),
    };
    for (const key of [
      "SIGNUP_ENABLED",
      "LOOPFARE_DEV_MODE",
      "ALLOW_PRIVATE_ORIGINS",
      "USAGE_TRACKING_ENABLED",
    ])
      delete (env as NodeJS.ProcessEnv)[key];
    const script = `import { config } from ${JSON.stringify(new URL("../src/config.ts", import.meta.url).href)}; console.log(JSON.stringify({ signup: config.signupEnabled, dev: config.devMode, privateOrigins: config.allowPrivateOrigins, tracking: config.usageTrackingEnabled }));`;
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "-e",
        script,
      ],
      { cwd: directory, env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      signup: false,
      dev: false,
      privateOrigins: false,
      tracking: false,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production refuses private origins independently of dev payment mode", () => {
  const script = fileURLToPath(new URL("../src/config.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      ALLOW_PRIVATE_ORIGINS: "true",
      LOOPFARE_DEV_MODE: "false",
    },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /ALLOW_PRIVATE_ORIGINS must be false in production/,
  );
});
