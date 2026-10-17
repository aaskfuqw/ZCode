import { describe, expect, it } from "vitest";
import { createMcpProcessRegistry } from "../src/mcp/process-registry.js";

describe("MCP process registry", () => {
  it("retains plugin ownership through a reconnect and removes a closed connection", () => {
    const registry = createMcpProcessRegistry();
    registry.registerConnection({
      connectionId: "connection",
      serverName: "plugin:fixture:server",
    });
    registry.recordProcessStarted({ connectionId: "connection", pid: 101 });
    expect(registry.listProcesses()).toEqual([
      { pid: 101, serverName: "plugin:fixture:server", mcpSource: "plugin", pluginName: "fixture" },
    ]);
    registry.recordProcessClosed({ connectionId: "connection" });
    registry.recordProcessStarted({ connectionId: "connection", pid: 102 });
    expect(registry.listProcesses().map(({ pid }) => pid)).toEqual([102]);
    registry.recordProcessClosed({ connectionId: "connection" });
    registry.unregisterConnection({ connectionId: "connection" });
    expect(registry.listProcesses()).toEqual([]);
  });

  it("keeps a child visible when closing its connection did not close the process", () => {
    const registry = createMcpProcessRegistry();
    registry.registerConnection({ connectionId: "connection", serverName: "fixture" });
    registry.recordProcessStarted({ connectionId: "connection", pid: 103 });
    registry.unregisterConnection({ connectionId: "connection" });
    expect(registry.listProcesses()).toEqual([
      { pid: 103, serverName: "fixture", mcpSource: "custom" },
    ]);
    registry.recordProcessClosed({ connectionId: "connection" });
    expect(registry.listProcesses()).toEqual([]);
  });
});
