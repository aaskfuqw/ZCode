import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteSessionMigrationError } from "./errors.js";
import { SQLITE_SESSION_SCHEMA_ID, SQLITE_SESSION_SCHEMA_SQL } from "./schema.js";

export const SQLITE_SESSION_SCHEMA_CHECKSUM = createHash("sha256")
  .update(SQLITE_SESSION_SCHEMA_SQL.trim())
  .digest("hex");

interface SchemaObject {
  name: string;
  type: string;
  sql: string;
}

let requiredSchemaObjects: SchemaObject[] | undefined;

export function inspectSessionSchema(db: DatabaseSync, dbPath: string): "initialize" | "none" {
  const ledger = db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='schema_migration'")
    .get();
  if (!ledger) {
    const existing = db
      .prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1")
      .get();
    if (existing) throw incompatibleSchemaError(dbPath);
    return "initialize";
  }

  const columns = db.prepare("PRAGMA table_info(schema_migration)").all();
  if (
    !["id", "checksum", "app_version", "time_applied"].every((name) =>
      columns.some((column) => column.name === name),
    )
  )
    throw incompatibleSchemaError(dbPath);

  const rows = db.prepare("SELECT id, checksum FROM schema_migration LIMIT 2").all();
  if (
    rows.length !== 1 ||
    rows[0]?.id !== SQLITE_SESSION_SCHEMA_ID ||
    rows[0]?.checksum !== SQLITE_SESSION_SCHEMA_CHECKSUM
  )
    throw incompatibleSchemaError(dbPath);
  // The ledger alone cannot prove that required columns, indexes or triggers still exist.
  const actual = new Map(
    readSchemaObjects(db).map((object) => [`${object.type}:${object.name}`, object.sql]),
  );
  for (const expected of currentSchemaObjects()) {
    if (actual.get(`${expected.type}:${expected.name}`) !== expected.sql)
      throw incompatibleSchemaError(dbPath);
  }
  return "none";
}

function readSchemaObjects(db: DatabaseSync): SchemaObject[] {
  const rows = db
    .prepare(
      "SELECT name, type, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
    )
    .all() as unknown as SchemaObject[];
  return rows.map((row) => ({ ...row, sql: row.sql.replace(/\s+/g, " ").trim() }));
}

function currentSchemaObjects(): SchemaObject[] {
  if (requiredSchemaObjects) return requiredSchemaObjects;
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(SQLITE_SESSION_SCHEMA_SQL);
    requiredSchemaObjects = readSchemaObjects(db);
    return requiredSchemaObjects;
  } finally {
    db.close();
  }
}

function incompatibleSchemaError(dbPath: string): SqliteSessionMigrationError {
  const path = dbPath === ":memory:" ? dbPath : resolve(dbPath);
  const reset =
    path === ":memory:"
      ? "Restart the process that owns this in-memory database."
      : `Close all ZCode Next processes using this database, then manually reset only ${JSON.stringify(path)}, ${JSON.stringify(`${path}-wal`)} and ${JSON.stringify(`${path}-shm`)}.`;
  return new SqliteSessionMigrationError(
    `Incompatible ZCode Next CLI session database at ${JSON.stringify(path)}. Only schema ${SQLITE_SESSION_SCHEMA_ID} is supported. ${reset} Keep all project and workspace files.`,
    { dbPath: path, kind: "checksum_mismatch", migrationId: SQLITE_SESSION_SCHEMA_ID },
  );
}
