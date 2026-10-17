import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";

it("preserves historical sessions and editable groups without reviving retired queue entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-retired-automation-"));
  const path = join(directory, "tasks.sqlite");
  const repo = new TaskIndexRepo(path);
  let db: DatabaseSync | undefined;
  const meta: ZCodeTaskMeta = {
    taskId: "real-session",
    traceId: "trace",
    title: "Existing conversation",
    workspacePath: "/project",
    workspaceIdentity: "remote:ssh:host:22:user:/project",
    mode: "default",
    createdAt: 1,
    updatedAt: 2,
    status: "completed",
  };
  const groupId = "zcode-default-group-off-peak";
  try {
    await repo.syncTaskMeta({ meta });
    repo.close();
    db = new DatabaseSync(path);
    db.prepare("UPDATE tasks SET off_peak_task_id=? WHERE task_id=?").run(
      "retired-task",
      meta.taskId,
    );
    db.prepare("INSERT INTO task_groups VALUES (?, ?, 'gray', 1, 2)").run(groupId, "Old group");
    db.prepare("INSERT INTO task_group_members VALUES (?, ?, ?, ?, ?, 1, 1, 1, 2)").run(
      groupId,
      meta.workspaceIdentity!,
      meta.workspacePath,
      meta.workspaceIdentity!,
      meta.taskId,
    );
    db.prepare(`INSERT INTO off_peak_tasks (
      off_peak_task_id, session_id, prompt, permission_mode, workspace_key, workspace_path,
      workspace_identity, status, queued_at, created_at, updated_at
    ) VALUES (?, ?, 'old prompt', 'default', ?, ?, ?, 'queued', 1, 1, 2)`).run(
      "retired-queue-entry",
      "never-created-session",
      meta.workspaceIdentity!,
      meta.workspacePath,
      meta.workspaceIdentity!,
    );
    const historicalQueue = db.prepare("SELECT * FROM off_peak_tasks").all();
    const migrationLedger = db.prepare("SELECT * FROM tasks_schema_migration").all();

    await repo.ensureReady();
    expect(await repo.getTaskMeta(meta)).toMatchObject(meta);
    expect(await repo.getTaskMeta({ ...meta, taskId: "never-created-session" })).toBeNull();
    const structure = await repo.queryGroupedTaskViewStructure({ workspaceScopes: [meta] });
    expect(structure.members).toEqual([
      expect.objectContaining({
        groupId,
        taskId: meta.taskId,
        workspaceKey: meta.workspaceIdentity,
      }),
    ]);
    expect(await repo.renameTaskGroup({ groupId, title: "My conversations" })).toMatchObject({
      id: groupId,
      title: "My conversations",
    });
    await repo.syncTaskMeta({ meta: { ...meta, title: "Continued conversation", updatedAt: 3 } });
    expect(await repo.getTaskMeta(meta)).toMatchObject({ title: "Continued conversation" });
    expect(
      db.prepare("SELECT off_peak_task_id FROM tasks WHERE task_id=?").get(meta.taskId)
        ?.off_peak_task_id,
    ).toBe("retired-task");
    expect(db.prepare("SELECT * FROM off_peak_tasks").all()).toEqual(historicalQueue);
    expect(db.prepare("SELECT * FROM tasks_schema_migration").all()).toEqual(migrationLedger);
    await repo.deleteTaskGroup({ groupId });
    expect(await repo.getTaskMeta(meta)).toMatchObject({ taskId: meta.taskId });
  } finally {
    repo.close();
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
