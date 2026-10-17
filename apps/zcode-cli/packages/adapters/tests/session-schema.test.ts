import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteSessionStore } from "../src/storage/session-store/sqlite-session-store.js";
import { runSqliteSessionMigrations } from "../src/storage/session-store/migration-runner.js";
import { SQLITE_SESSION_SCHEMA_ID } from "../src/storage/session-store/schema.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("creates the complete terminal schema, including indexes, constraints and sequence guards", () => {
  const db = new DatabaseSync(":memory:");
  try {
    runSqliteSessionMigrations(db, ":memory:");
    const rows = db
      .prepare(
        "SELECT name, type, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != 'schema_migration'",
      )
      .all() as Array<{ name: string; type: string; sql: string }>;
    const schema = rows
      .sort((a, b) => a.name.localeCompare(b.name, "en"))
      .map(({ name, type, sql }) => ({
        name,
        type,
        sql: sql.replace(/\s+/g, " ").trim(),
      }));
    // Captured from the former chain's final schema; no historical SQL is required at runtime.
    expect(createHash("sha256").update(JSON.stringify(schema)).digest("hex")).toBe(
      "60853ca287788bbf67b54f510168104f0594f0a2e1f958b82b79699f48b17c44",
    );
  } finally {
    db.close();
  }
});

const ledger = `CREATE TABLE schema_migration (
  id TEXT PRIMARY KEY, checksum TEXT NOT NULL, app_version TEXT, time_applied INTEGER NOT NULL
);`;
const obsolete = [
  [
    "unversioned data",
    "CREATE TABLE session (id TEXT PRIMARY KEY, data TEXT); INSERT INTO session VALUES ('keep', 'untouched');",
  ],
  [
    "historical ledger",
    `${ledger} INSERT INTO schema_migration VALUES ('0022_backfilled_session_reasoning', 'old', '0.16.5', 1);`,
  ],
  ["empty ledger", ledger],
  ["malformed ledger", "CREATE TABLE schema_migration (id TEXT);"],
  [
    "future schema",
    `${ledger} INSERT INTO schema_migration VALUES ('0002_future_schema', 'future', NULL, 1);`,
  ],
] as const;

const damagedCurrentSchema = [
  ["missing table", "DROP TABLE input_history"],
  ["missing column", "ALTER TABLE session DROP COLUMN title_message_id"],
  ["missing index", "DROP INDEX message_session_sequence_idx"],
  ["missing sequence trigger", "DROP TRIGGER message_sequence_autofill"],
  [
    "replaced sequence trigger",
    `DROP TRIGGER message_sequence_autofill;
     CREATE TRIGGER message_sequence_autofill AFTER INSERT ON message BEGIN SELECT 1; END;`,
  ],
] as const;

describe.each(["sync", "async"] as const)("%s incompatible schema admission", (mode) => {
  it.each(obsolete)(
    "rejects %s before WAL or data writes and explains the exact reset path",
    async (_name, sql) => {
      const root = await mkdtemp(join(tmpdir(), "zcode-incompatible-schema-"));
      roots.push(root);
      const dbPath = join(root, "overridden-cli.sqlite");
      const db = new DatabaseSync(dbPath);
      db.exec(sql);
      db.close();
      const before = await readFile(dbPath);
      let error: unknown;
      try {
        const store =
          mode === "sync"
            ? new SqliteSessionStore({ dbPath })
            : await SqliteSessionStore.openStartup({ dbPath });
        store.close();
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({
        dbPath,
        kind: "checksum_mismatch",
        migrationId: SQLITE_SESSION_SCHEMA_ID,
      });
      expect(String(error)).toContain(
        `Incompatible ZCode Next CLI session database at ${JSON.stringify(dbPath)}`,
      );
      expect(String(error)).toContain("manually reset only");
      expect(String(error)).toContain(`${dbPath}-wal`);
      expect(String(error)).toContain(`${dbPath}-shm`);
      expect(String(error)).toContain("Keep all project and workspace files");
      expect(await readFile(dbPath)).toEqual(before);
      await expect(access(`${dbPath}-wal`)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(`${dbPath}-shm`)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each(damagedCurrentSchema)(
    "rejects a current ledger with %s before WAL without changing the ledger or data",
    async (_name, sql) => {
      const root = await mkdtemp(join(tmpdir(), "zcode-incomplete-schema-"));
      roots.push(root);
      const dbPath = join(root, "overridden-cli.sqlite");
      const db = new DatabaseSync(dbPath);
      runSqliteSessionMigrations(db, dbPath);
      db.exec("PRAGMA journal_mode = DELETE");
      db.exec(sql);
      const beforeLedger = db.prepare("SELECT * FROM schema_migration").all();
      db.close();
      const before = await readFile(dbPath);

      let error: unknown;
      try {
        const store =
          mode === "sync"
            ? new SqliteSessionStore({ dbPath })
            : await SqliteSessionStore.openStartup({ dbPath });
        store.close();
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({
        dbPath,
        kind: "checksum_mismatch",
        migrationId: SQLITE_SESSION_SCHEMA_ID,
      });
      expect(String(error)).toContain("manually reset only");
      expect(await readFile(dbPath)).toEqual(before);
      await expect(access(`${dbPath}-wal`)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(`${dbPath}-shm`)).rejects.toMatchObject({ code: "ENOENT" });

      const reopened = new DatabaseSync(dbPath, { readOnly: true });
      try {
        expect(reopened.prepare("SELECT * FROM schema_migration").all()).toEqual(beforeLedger);
        expect(reopened.prepare("PRAGMA journal_mode").get()).toMatchObject({
          journal_mode: "delete",
        });
      } finally {
        reopened.close();
      }
    },
  );
});

it("reopens the current baseline with an unrelated extra table without changing either owner", () => {
  const db = new DatabaseSync(":memory:");
  try {
    runSqliteSessionMigrations(db, ":memory:");
    db.exec(
      "CREATE TABLE unrelated (id TEXT PRIMARY KEY, value TEXT); INSERT INTO unrelated VALUES ('keep', 'untouched')",
    );
    const before = db.prepare("SELECT * FROM schema_migration").all();
    expect(() => runSqliteSessionMigrations(db, ":memory:")).not.toThrow();
    expect(db.prepare("SELECT * FROM schema_migration").all()).toEqual(before);
    expect(db.prepare("SELECT * FROM unrelated").all()).toEqual([
      { id: "keep", value: "untouched" },
    ]);
  } finally {
    db.close();
  }
});

it("rejects a mismatched baseline checksum without changing its ledger", () => {
  const db = new DatabaseSync(":memory:");
  try {
    runSqliteSessionMigrations(db, ":memory:");
    db.exec("UPDATE schema_migration SET checksum='changed'");
    const before = db.prepare("SELECT * FROM schema_migration").all();
    expect(() => runSqliteSessionMigrations(db, ":memory:")).toThrow(
      "Incompatible ZCode Next CLI session database",
    );
    expect(db.prepare("SELECT * FROM schema_migration").all()).toEqual(before);
  } finally {
    db.close();
  }
});
