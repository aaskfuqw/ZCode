import type { DatabaseMigrationFacts } from "@zcode/shared";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createRequire } from "node:module";
// 与既有 Repo 一致：避免构建器把 node:sqlite 改写成不存在的 npm sqlite 包。
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");
import {
  runTasksDatabaseMigrations,
  inspectTasksMigrationKind,
} from "#src/session/tasksDatabase/migrations.js";
import { markTasksStoragePrepared } from "#src/session/tasksDatabase/prepared.js";

export type TasksStoragePhase =
  | "checking"
  | "waiting_for_lock"
  | "migrating"
  | "maintaining"
  | "committing"
  | "ready";
const LOCK_WAIT_MS = 60 * 60_000;

/** The Host Worker and direct Repo opens share one current-schema implementation. */
export async function prepareTasksIndexStorage(
  path: string,
  onProgress: (phase: TasksStoragePhase, migration?: DatabaseMigrationFacts) => void,
): Promise<void> {
  // 回调拿到的是当时事实，不共享后续执行会继续递增的内部对象。
  const report = (phase: TasksStoragePhase, migration?: DatabaseMigrationFacts) =>
    onProgress(phase, migration ? { ...migration } : undefined);
  report("checking");
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  let failure: unknown;
  let migration: DatabaseMigrationFacts | undefined;
  try {
    db.exec("PRAGMA busy_timeout = 25");
    db.exec("PRAGMA foreign_keys = ON");
    const deadline = Date.now() + LOCK_WAIT_MS;
    const acquire = async (operation: string | (() => void)) => {
      // 预检前后可分别遇锁；确认迁移后的等待需要重新发布可见状态。
      let waiting = false;
      for (;;) {
        try {
          if (typeof operation === "string") db.exec(operation);
          else operation();
          return;
        } catch (error) {
          const code = (error as { errcode?: number }).errcode;
          if (typeof code !== "number" || (code & 0xff) !== 5) throw error;
          if (Date.now() >= deadline)
            throw Object.assign(new Error("Task storage lock wait expired", { cause: error }), {
              kind: "lock_timeout",
            });
          if (!waiting) {
            waiting = true;
            report("waiting_for_lock", migration);
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
      }
    };
    await acquire(() => {
      migration = { kind: inspectTasksMigrationKind(db), executedCount: 0, committedCount: 0 };
    });
    report("checking", migration);
    await acquire("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    await acquire("BEGIN IMMEDIATE");
    runTasksDatabaseMigrations(db, { transactionOpen: true, migration, onProgress: report });
    // Publish the committed facts before closing; close failures must not imply a rollback.
    report("committing", migration);
  } catch (error) {
    failure = error;
    // 失败事实随原异常交给 Worker，不倒退发布 checking/migrating，也不覆盖首因。
    if (migration && error && typeof error === "object") {
      try {
        Object.assign(error, { startupMigration: { ...migration } });
      } catch {
        /* 不可扩展异常仍保留原错误。 */
      }
    }
    throw error;
  } finally {
    try {
      db.close();
    } catch (error) {
      if (!failure) throw error;
    }
  }
  markTasksStoragePrepared(path);
  report("ready", migration);
}
