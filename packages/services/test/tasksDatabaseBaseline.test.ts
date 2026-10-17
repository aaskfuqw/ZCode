import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import {
  areTasksDatabaseMigrationsApplied,
  inspectTasksMigrationKind,
  runTasksDatabaseMigrations,
} from "../src/session/tasksDatabase/migrations.js";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { AutomationRepo } from "../src/session/automationRepo.js";

describe("Next task database baseline", () => {
  const databases: DatabaseSync[] = [];
  const open = () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    return db;
  };
  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it("initializes the complete current schema once without retired tables or columns", () => {
    const db = open();
    expect(inspectTasksMigrationKind(db)).toBe("initialize");
    runTasksDatabaseMigrations(db);
    expect(inspectTasksMigrationKind(db)).toBe("none");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(tables.map((row) => row.name).sort()).toEqual([
      "automation_runs",
      "automations",
      "task_group_members",
      "task_group_view_node_orders",
      "task_group_workspace_bootstraps",
      "task_groups",
      "tasks",
      "tasks_schema_migration",
    ]);
    expect(
      db
        .prepare("PRAGMA table_info(tasks)")
        .all()
        .map((row) => row.name),
    ).not.toContain("off_peak_task_id");
    const automationColumns = db
      .prepare("PRAGMA table_info(automations)")
      .all()
      .map((row) => row.name);
    expect(automationColumns).toContain("model_selection");
    for (const retired of ["model", "provider", "thought_level"])
      expect(automationColumns).not.toContain(retired);
    const ledger = db.prepare("SELECT * FROM tasks_schema_migration").all();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.id).toBe("0001_next_schema");
    runTasksDatabaseMigrations(db);
    expect(db.prepare("SELECT * FROM tasks_schema_migration").all()).toEqual(ledger);
  });

  it.each(["0001_adopt_task_schema", "0003_official_glm_selection", "future_schema"])(
    "rejects unsupported baseline %s without adopting or erasing its data",
    (id) => {
      const db = open();
      db.exec("CREATE TABLE tasks(value TEXT); INSERT INTO tasks VALUES('preserved');");
      db.exec(
        "CREATE TABLE tasks_schema_migration(id TEXT PRIMARY KEY, checksum TEXT NOT NULL, time_applied INTEGER NOT NULL)",
      );
      db.prepare("INSERT INTO tasks_schema_migration VALUES(?, 'old', 1)").run(id);
      const before = db.prepare("SELECT * FROM tasks").all();
      expect(() => runTasksDatabaseMigrations(db)).toThrow("Incompatible Next task database");
      expect(db.prepare("SELECT * FROM tasks").all()).toEqual(before);
      expect(db.prepare("SELECT id FROM tasks_schema_migration").get()?.id).toBe(id);
      expect(db.isTransaction).toBe(false);
    },
  );

  it("rejects missing or changed schema and checksums even with a current ledger", () => {
    const old = open();
    old.exec("CREATE TABLE tasks(value TEXT)");
    expect(() => runTasksDatabaseMigrations(old)).toThrow("missing baseline");
    expect(
      old.prepare("SELECT name FROM sqlite_master WHERE name='tasks_schema_migration'").get(),
    ).toBeUndefined();
    const db = open();
    runTasksDatabaseMigrations(db);
    db.exec("UPDATE tasks_schema_migration SET checksum='broken'");
    expect(() => areTasksDatabaseMigrationsApplied(db)).toThrow("checksum mismatch");
    const changed = open();
    runTasksDatabaseMigrations(changed);
    changed.exec("ALTER TABLE tasks DROP COLUMN searchable_text");
    expect(() => areTasksDatabaseMigrationsApplied(changed)).toThrow("schema mismatch: tasks");
  });

  it("rolls back the entire initialization when commit preparation fails", () => {
    const db = open();
    expect(() =>
      runTasksDatabaseMigrations(db, {
        onProgress: (phase) => {
          if (phase === "committing") throw new Error("injected failure");
        },
      }),
    ).toThrow("injected failure");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
    runTasksDatabaseMigrations(db);
    expect(areTasksDatabaseMigrationsApplied(db)).toBe(true);
  });

  it.each(["tasks", "automations"])(
    "initializes through %s and preserves current records on reopen",
    async (first) => {
      const root = await mkdtemp(join(tmpdir(), "next-task-baseline-"));
      const path = join(root, "tasks.sqlite");
      const tasks = new TaskIndexRepo(path);
      const automations = new AutomationRepo(path);
      try {
        await (first === "tasks" ? tasks : automations).ensureReady();
        await tasks.syncTaskMeta({
          meta: {
            taskId: "session",
            traceId: "trace",
            title: "Current task",
            workspacePath: "/project",
            workspaceIdentity: "remote:test:/project",
            mode: "default",
            createdAt: 1,
            updatedAt: 2,
          },
        });
        const automation = await automations.create(
          {
            title: "Current automation",
            cronExpr: "* * * * *",
            prompt: "Run",
            recurring: true,
            workspacePath: "/project",
            modelSelection: { providerId: "proxy", modelId: "model" },
          },
          { nextRunAt: 100 },
        );
        tasks.close();
        automations.close();
        expect(
          await tasks.getTaskMeta({
            taskId: "session",
            workspacePath: "/project",
            workspaceIdentity: "remote:test:/project",
          }),
        ).toMatchObject({ title: "Current task" });
        expect(await automations.get(automation.automationId)).toMatchObject({
          modelSelection: { providerId: "proxy", modelId: "model" },
        });
      } finally {
        tasks.close();
        automations.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("serializes concurrent empty-database initialization through the existing SQLite lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "next-task-concurrent-"));
    const path = join(root, "tasks.sqlite");
    const workers: Worker[] = [];
    try {
      const compiled = await build({
        entryPoints: [resolve("packages/services/src/session/tasksDatabase/migrations.ts")],
        bundle: true,
        write: false,
        platform: "node",
        format: "cjs",
        alias: { "#src": resolve("packages/services/src") },
        define: { "import.meta.url": JSON.stringify(import.meta.url) },
      });
      const gate = new SharedArrayBuffer(4);
      for (let index = 0; index < 2; index++) {
        workers.push(
          new Worker(
            `${compiled.outputFiles[0]!.text}
          const { parentPort, workerData } = require('node:worker_threads');
          const database = new (require('node:sqlite').DatabaseSync)(workerData.path, { timeout: 5000 });
          const gate = new Int32Array(workerData.gate);
          parentPort.postMessage('ready');
          Atomics.wait(gate, 0, 0);
          module.exports.runTasksDatabaseMigrations(database);
          database.close();`,
            { eval: true, workerData: { path, gate } },
          ),
        );
      }
      const exits = workers.map((worker) => once(worker, "exit"));
      await Promise.all(workers.map((worker) => once(worker, "message")));
      Atomics.store(new Int32Array(gate), 0, 1);
      Atomics.notify(new Int32Array(gate), 0);
      expect(await Promise.all(exits)).toEqual([[0], [0]]);
      const db = new DatabaseSync(path);
      try {
        expect(db.prepare("SELECT * FROM tasks_schema_migration").all()).toHaveLength(1);
        expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
      } finally {
        db.close();
      }
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
