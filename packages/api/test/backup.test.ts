import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

test("online backup restores WAL-backed account/payment records and refuses overwrite", () => {
  const directory = mkdtempSync(join(tmpdir(), "loopfare-backup-"));
  const source = join(directory, "live.sqlite"),
    target = join(directory, "backup.sqlite");
  const database = new Database(source);
  const script = fileURLToPath(
    new URL("../../../scripts/backup.mjs", import.meta.url),
  );
  try {
    database.pragma("journal_mode = WAL");
    database.exec(
      "CREATE TABLE accounts(id TEXT PRIMARY KEY, api_key_hash TEXT); CREATE TABLE payments(id TEXT PRIMARY KEY, account_id TEXT REFERENCES accounts(id)); INSERT INTO accounts VALUES ('acct','hashed-example'); INSERT INTO payments VALUES ('payment','acct');",
    );
    const result = spawnSync(process.execPath, [script, source, target], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).counts.payments, 1);
    const restored = new Database(target, { readonly: true });
    try {
      assert.deepEqual(
        restored.prepare("SELECT * FROM accounts").all(),
        database.prepare("SELECT * FROM accounts").all(),
      );
      assert.deepEqual(
        restored.prepare("SELECT * FROM payments").all(),
        database.prepare("SELECT * FROM payments").all(),
      );
    } finally {
      restored.close();
    }
    assert.notEqual(
      spawnSync(process.execPath, [script, source, target]).status,
      0,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
