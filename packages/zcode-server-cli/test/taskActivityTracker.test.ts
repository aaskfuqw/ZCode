import { Emitter } from "@zcode/rpc";
import type {
  IZCodeAgentService,
  ZCodeAgentRuntimeLifecycleEvent,
  ZCodeAgentWorkspaceTarget,
} from "@zcode/services";
import type { SessionActivityEvent } from "@zcode/shared/zcode-protocol-v4";
import { describe, expect, it } from "vitest";
import { createTaskActivityTracker } from "../src/server-core/taskActivityTracker.js";

function fact(kind: "turn.started" | "turn.terminal", sessionId: string): SessionActivityEvent {
  const base = {
    eventId: `${kind}-${sessionId}`,
    eventSeq: 1,
    sessionId,
  };
  return kind === "turn.started" ? { ...base, kind } : { ...base, kind };
}

describe("Core-local TaskActivityTracker", () => {
  it("counts authoritative turn facts for all workspace clients and deduplicates by workspaceKey + sessionId", () => {
    const lifecycle = new Emitter<ZCodeAgentRuntimeLifecycleEvent>();
    const activityByWorkspace = new Map<string, Emitter<SessionActivityEvent>>();
    const workspaceKey = (target: ZCodeAgentWorkspaceTarget): string =>
      target.workspaceIdentity?.trim() || target.workspacePath;
    const agentService = {
      onAgentRuntimeLifecycle: lifecycle.event,
      onDynamicSessionActivity(target: ZCodeAgentWorkspaceTarget) {
        const key = workspaceKey(target);
        let emitter = activityByWorkspace.get(key);
        if (!emitter) {
          emitter = new Emitter<SessionActivityEvent>();
          activityByWorkspace.set(key, emitter);
        }
        return emitter.event;
      },
    } as Pick<IZCodeAgentService, "onAgentRuntimeLifecycle" | "onDynamicSessionActivity">;
    const tracker = createTaskActivityTracker(agentService);
    const targetA = { workspacePath: "/same/path", workspaceIdentity: "ssh://host-a/repo" };
    const targetB = { workspacePath: "/same/path", workspaceIdentity: "ssh://host-b/repo" };
    lifecycle.fire({
      ...targetA,
      workspaceKey: targetA.workspaceIdentity,
      runtimeIdentity: {
        generation: 1,
        identity: "runtime-a",
        workspaceKey: targetA.workspaceIdentity,
      },
      state: "available",
    });
    lifecycle.fire({
      ...targetB,
      workspaceKey: targetB.workspaceIdentity,
      runtimeIdentity: {
        generation: 1,
        identity: "runtime-b",
        workspaceKey: targetB.workspaceIdentity,
      },
      state: "available",
    });

    activityByWorkspace.get(targetA.workspaceIdentity)?.fire(fact("turn.started", "session-1"));
    activityByWorkspace.get(targetA.workspaceIdentity)?.fire(fact("turn.started", "session-1"));
    activityByWorkspace.get(targetB.workspaceIdentity)?.fire(fact("turn.started", "session-1"));
    expect(tracker.readRunningTaskCount()).toBe(2);

    activityByWorkspace.get(targetA.workspaceIdentity)?.fire(fact("turn.terminal", "session-1"));
    expect(tracker.readRunningTaskCount()).toBe(1);

    lifecycle.fire({
      ...targetB,
      workspaceKey: targetB.workspaceIdentity,
      runtimeIdentity: {
        generation: 1,
        identity: "runtime-b",
        workspaceKey: targetB.workspaceIdentity,
      },
      state: "unavailable",
    });
    expect(tracker.readRunningTaskCount()).toBe(0);
    tracker.dispose();
  });

  it("publishes count changes immediately for Supervisor task-activity snapshots", () => {
    const lifecycle = new Emitter<ZCodeAgentRuntimeLifecycleEvent>();
    const activity = new Emitter<SessionActivityEvent>();
    const agentService = {
      onAgentRuntimeLifecycle: lifecycle.event,
      onDynamicSessionActivity: () => activity.event,
    } as Pick<IZCodeAgentService, "onAgentRuntimeLifecycle" | "onDynamicSessionActivity">;
    const tracker = createTaskActivityTracker(agentService);
    const counts: number[] = [];
    const subscription = tracker.onDidChangeRunningTaskCount((count) => counts.push(count));
    lifecycle.fire({
      workspacePath: "/repo",
      workspaceKey: "/repo",
      runtimeIdentity: { generation: 1, identity: "runtime", workspaceKey: "/repo" },
      state: "available",
    });
    activity.fire(fact("turn.started", "session"));
    activity.fire(fact("turn.terminal", "session"));
    expect(counts).toEqual([1, 0]);
    subscription.dispose();
    tracker.dispose();
  });
});
