import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
