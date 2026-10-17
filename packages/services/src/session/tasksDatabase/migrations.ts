import type { DatabaseMigrationFacts } from "@zcode/shared";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { TASK_INDEX_SCHEMA, AUTOMATION_SCHEMA } from "#src/session/tasksDatabase/schema.js";

const { DatabaseSync: SchemaDatabase } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");
const BASELINE_ID = "0001_next_schema";
const LEDGER_SCHEMA = `CREATE TABLE tasks_schema_migration (
  id TEXT PRIMARY KEY, checksum TEXT NOT NULL, time_applied INTEGER NOT NULL
)`;
const SCHEMA = TASK_INDEX_SCHEMA + AUTOMATION_SCHEMA;
const CHECKSUM = createHash("sha256").update(SCHEMA).digest("hex");
const CATALOG_SQL = "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL";
let expectedSchema: ReadonlyMap<string, string> | undefined;

function currentSchema(): ReadonlyMap<string, string> {
  if (!expectedSchema) {
    const db = new SchemaDatabase(":memory:");
    try {
      db.exec(LEDGER_SCHEMA + ";" + SCHEMA);
      expectedSchema = new Map(
        db
          .prepare(CATALOG_SQL)
          .all()
          .map((row) => [String(row.name), String(row.sql)]),
      );
    } finally {
      db.close();
    }
  }
  return expectedSchema;
}

function incompatibleDatabase(db: DatabaseSync, reason: string, kind = "checksum_mismatch") {
  const location = db.location() ?? ":memory:";
  return Object.assign(
    new Error(
      `Incompatible Next task database (${reason}): ${location}. ` +
        "Close every Next process using this database, back up and move only this file and its " +
        "-wal/-shm sidecars, then restart to initialize current task, group, and automation state. " +
        "Keep project and workspace files.",
    ),
    { kind, migrationId: BASELINE_ID, dbPath: location },
  );
}

/** Validates each opened connection, including a file replaced after startup preparation. */
export function areTasksDatabaseMigrationsApplied(db: DatabaseSync): boolean {
  const actual = new Map(
    db
      .prepare(CATALOG_SQL)
      .all()
      .map((row) => [String(row.name), String(row.sql)]),
  );
  if (actual.size === 0) return false;
  if (!actual.has("tasks_schema_migration")) throw incompatibleDatabase(db, "missing baseline");
  if (actual.get("tasks_schema_migration") !== currentSchema().get("tasks_schema_migration"))
    throw incompatibleDatabase(db, "unsupported baseline ledger");
  const rows = db.prepare("SELECT id, checksum FROM tasks_schema_migration").all();
  if (rows.length !== 1 || rows[0]?.id !== BASELINE_ID)
    throw incompatibleDatabase(db, "unsupported development baseline");
  if (rows[0].checksum !== CHECKSUM)
    throw incompatibleDatabase(db, "checksum mismatch", "checksum_mismatch");
  for (const [name, sql] of currentSchema()) {
    if (actual.get(name) !== sql) throw incompatibleDatabase(db, `schema mismatch: ${name}`);
  }
  return true;
}

/** A read-only progress precheck; the runner repeats validation under the write lock. */
export function inspectTasksMigrationKind(db: DatabaseSync): DatabaseMigrationFacts["kind"] {
  return areTasksDatabaseMigrationsApplied(db) ? "none" : "initialize";
}

export function runTasksDatabaseMigrations(
  db: DatabaseSync,
  options: {
    transactionOpen?: boolean;
    migration?: DatabaseMigrationFacts;
    onProgress?: (phase: "migrating" | "committing", migration: DatabaseMigrationFacts) => void;
  } = {},
): void {
  if (!options.transactionOpen) db.exec("BEGIN IMMEDIATE");
  const facts: DatabaseMigrationFacts = options.migration ?? {
    kind: "none",
    executedCount: 0,
    committedCount: 0,
  };
  try {
    const applied = areTasksDatabaseMigrationsApplied(db);
    facts.kind = applied ? "none" : "initialize";
    facts.lastAppliedMigrationId = applied ? BASELINE_ID : null;
    if (!applied) {
      options.onProgress?.("migrating", { ...facts });
      db.exec(LEDGER_SCHEMA + ";" + SCHEMA);
      db.prepare("INSERT INTO tasks_schema_migration VALUES(?,?,?)").run(
        BASELINE_ID,
        CHECKSUM,
        Date.now(),
      );
      facts.executedCount++;
    }
    options.onProgress?.("committing", { ...facts });
    db.exec("COMMIT");
    facts.committedCount = facts.executedCount;
  } catch (error) {
    try {
      if (db.isTransaction) db.exec("ROLLBACK");
    } catch {
      // Preserve the initialization failure; closing the connection recovers its transaction.
    }
    if (error && typeof error === "object") Object.assign(error, { migrationId: BASELINE_ID });
    throw error;
  }
}
