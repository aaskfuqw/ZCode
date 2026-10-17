const PLUGIN_MCP_NAMESPACE_PREFIX = "plugin:";
export type McpProcessSource = "builtin" | "plugin" | "custom";

/** Local process ownership used by the Resource Manager, not a resource sampler. */
export interface McpTrackedProcess {
  pid: number;
  serverName: string;
  mcpSource: McpProcessSource;
  pluginName?: string;
}

export interface McpProcessRegistry {
  registerConnection(input: {
    connectionId: string;
    serverName: string;
    source?: McpProcessSource;
  }): void;
  unregisterConnection(input: { connectionId: string }): void;
  recordProcessStarted(input: { connectionId: string; pid: number }): void;
  recordProcessClosed(input: { connectionId: string }): void;
  listProcesses(): McpTrackedProcess[];
}

export function createMcpProcessRegistry(): McpProcessRegistry {
  const connections = new Map<
    string,
    { serverName: string; source: McpProcessSource; registered: boolean; pid?: number }
  >();
  return {
    registerConnection({ connectionId, serverName, source }) {
      connections.set(connectionId, {
        serverName,
        registered: true,
        source:
          source ??
          (serverName === "node_repl"
            ? "builtin"
            : serverName.startsWith(PLUGIN_MCP_NAMESPACE_PREFIX)
              ? "plugin"
              : "custom"),
      });
    },
    unregisterConnection({ connectionId }) {
      // A failed close may leave a real child alive. Keep it visible until its close is observed.
      const connection = connections.get(connectionId);
      if (!connection || connection.pid === undefined) connections.delete(connectionId);
      else connection.registered = false;
    },
    recordProcessStarted({ connectionId, pid }) {
      const connection = connections.get(connectionId);
      if (connection && Number.isInteger(pid) && pid > 0) connection.pid = pid;
    },
    recordProcessClosed({ connectionId }) {
      const connection = connections.get(connectionId);
      if (!connection) return;
      if (!connection.registered) connections.delete(connectionId);
      else connection.pid = undefined;
    },
    listProcesses() {
      return [...connections.values()].flatMap(({ pid, serverName, source }) => {
        if (pid === undefined) return [];
        const pluginName = resolvePluginName(serverName);
        return [{ pid, serverName, mcpSource: source, ...(pluginName ? { pluginName } : {}) }];
      });
    },
  };
}

function resolvePluginName(serverName: string): string | undefined {
  if (!serverName.startsWith(PLUGIN_MCP_NAMESPACE_PREFIX)) return undefined;
  return serverName.slice(PLUGIN_MCP_NAMESPACE_PREFIX.length).split(":")[0]?.trim() || undefined;
}
