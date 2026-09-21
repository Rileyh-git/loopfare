import { existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Back up the previous schema before importing the API (which runs migrations).
const source = resolve(process.env.DATABASE_PATH || "./data/loopfare.db");
if (existsSync(source)) {
  const destination = `${source}.pre-v0.3.0.sqlite`;
  if (!existsSync(destination)) {
    const temporary = `${destination}.${Date.now()}.partial`;
    const result = spawnSync(process.execPath, ["scripts/backup.mjs", source, temporary], {
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error("Pre-migration backup failed; refusing startup");
    renameSync(temporary, destination);
  }
}
await import("../packages/api/dist/index.js");
