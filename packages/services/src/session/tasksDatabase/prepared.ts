import type { DatabaseSync } from "node:sqlite";
import { areTasksDatabaseMigrationsApplied } from "#src/session/tasksDatabase/migrations.js";
// 仅当前进程的启动交接凭据；不落盘、不代替 SQLite 账本，不影响不同路径的新库。
const prepared = new Set<string>();
export function markTasksStoragePrepared(path: string): void {
  prepared.add(path);
}
export function isTasksStoragePrepared(path: string, db: DatabaseSync): boolean {
  return prepared.has(path) && areTasksDatabaseMigrationsApplied(db);
}
