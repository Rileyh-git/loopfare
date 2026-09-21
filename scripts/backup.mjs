import Database from "better-sqlite3";
import { chmodSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg)
  throw new Error(
    "Usage: node scripts/backup.mjs <source.sqlite> <new-backup.sqlite>",
  );
const source = resolve(sourceArg),
  destination = resolve(destinationArg);
if (source === destination || existsSync(destination))
  throw new Error(
    "Destination must be a new file; existing backups are never overwritten",
  );
process.umask(0o077);
const database = new Database(source, { readonly: true, fileMustExist: true });
try {
  await database.backup(destination);
  chmodSync(destination, 0o600);
  const restored = new Database(destination, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const checks = restored.pragma("integrity_check");
    if (checks.some((row) => row.integrity_check !== "ok"))
      throw new Error("Backup integrity check failed");
    if (restored.pragma("foreign_key_check").length)
      throw new Error("Backup foreign key check failed");
    const counts = {};
    for (const table of [
      "accounts",
      "projects",
      "routes",
      "payments",
      "buyer_budgets",
      "budget_reservations",
    ]) {
      if (
        restored
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(table)
      )
        counts[table] = restored
          .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
          .get().count;
    }
    console.log(
      JSON.stringify({
        event: "backup_verified",
        destination,
        counts,
        checkedAt: new Date().toISOString(),
        reminder:
          "Store the origin encryption key separately in your approved secret backup; this does not configure provider schedules.",
      }),
    );
  } finally {
    restored.close();
  }
} finally {
  database.close();
}
