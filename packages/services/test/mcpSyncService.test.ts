import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpSyncService } from "../src/mcp-sync/mcpSyncService.js";

function makeHome() {
  return mkdtempSync(join(tmpdir(), "zcode-mcp-sync-home-"));
}

async function writeZcodeUserMcp(home: string, servers: Record<string, Record<string, unknown>>) {
  const configPath = join(home, ".zcode-next", "cli", "config.json");
  await mkdir(join(home, ".zcode-next", "cli"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ mcp: { servers } }, null, 2)}\n`);
  return configPath;
}

async function writeAgentsUserMcp(home: string, servers: Record<string, Record<string, unknown>>) {
  const configPath = join(home, ".agents", "mcp.json");
  await mkdir(join(home, ".agents"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
  return configPath;
}

async function readRemoteZcodeServers(home: string) {
  const raw = await readFile(join(home, ".zcode-next", "cli", "config.json"), "utf-8");
  const parsed = JSON.parse(raw) as {
    mcp?: { servers?: Record<string, Record<string, unknown>> };
  };
  return parsed.mcp?.servers ?? {};
}

async function writeObsoleteZcodeMcp(
  configPath: string,
  kind: "server enable" | "directory override",
) {
  const raw = JSON.stringify({
    model: { provider: "current-provider", model: "current-model" },
    mcp: {
      servers: {
        context7: {
          command: "npx",
          ...(kind === "server enable" ? { enable: false } : {}),
        },
      },
      ...(kind === "directory override" ? { [dirname(configPath)]: { context7: false } } : {}),
    },
  });
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, raw);
  return raw;
}

describe("mcp sync service", () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("lists user zcode MCP servers as local candidates", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await writeZcodeUserMcp(home, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      },
    });
    const service = createMcpSyncService();

    const result = await service.listLocalUserMcpCandidates();

    expect(result.localHomeDir).toBe(home);
    expect(result.candidates).toMatchObject([
      {
        name: "context7",
        enabled: true,
        source: "zcode",
        path: join(home, ".zcode-next", "cli", "config.json"),
        config: {
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
        },
      },
    ]);
  });

  it("marks a candidate disabled when only enabled:false is present", async () => {
    const home = makeHome();
    process.env.HOME = home;
    // 外部工具/手工编辑写的是 enabled:false；同步侧不能把它当成启用状态。
    await writeZcodeUserMcp(home, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        enabled: false,
      },
    });
    const service = createMcpSyncService();

    const result = await service.listLocalUserMcpCandidates();

    expect(result.candidates[0]).toMatchObject({ name: "context7", enabled: false });
  });

  it("writes only current enabled state when toggling a server", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await writeZcodeUserMcp(home, {
      context7: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        enabled: true,
      },
    });
    const service = createMcpSyncService();

    await service.saveMcpToUserDirectory({
      action: "set-enabled",
      source: "zcodeagentmcp",
      name: "context7",
      enabled: false,
    });

    expect((await readRemoteZcodeServers(home)).context7).toEqual({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      enabled: false,
    });

    await service.saveMcpToUserDirectory({
      action: "set-enabled",
      source: "zcodeagentmcp",
      name: "context7",
      enabled: true,
    });

    expect((await readRemoteZcodeServers(home)).context7).toEqual({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    });
  });

  describe.each(["server enable", "directory override"] as const)("obsolete %s", (kind) => {
    it("rejects user reads and saves with the actual path without changing the file", async () => {
      const home = makeHome();
      process.env.HOME = home;
      const configPath = join(home, ".zcode-next", "cli", "config.json");
      const raw = await writeObsoleteZcodeMcp(configPath, kind);
      const service = createMcpSyncService();
      const operations = [
        () => service.loadMcpFromUserDirectory(),
        () => service.listLocalUserMcpCandidates(),
        () => service.listRemoteUserMcpStatuses({ names: ["context7"] }),
        () => service.exportMcpServers({ serverIds: [] }),
        () => service.importMcpServers({ servers: [], localHomeDir: home, overwrite: false }),
        () =>
          service.saveMcpToUserDirectory({
            action: "upsert",
            source: "zcodeagentmcp",
            name: "context7",
            config: { command: "current-command" },
          }),
        () =>
          service.saveMcpToUserDirectory({
            action: "delete",
            source: "zcodeagentmcp",
            name: "context7",
          }),
        () =>
          service.saveMcpToUserDirectory({
            action: "set-enabled",
            source: "zcodeagentmcp",
            name: "context7",
            enabled: true,
          }),
      ];

      for (const operation of operations) {
        await expect(operation()).rejects.toThrow(
          `Incompatible ZCode Next MCP configuration: ${configPath}. Manually replace obsolete`,
        );
        await expect(readFile(configPath, "utf-8")).resolves.toBe(raw);
      }
    });

    it("rejects workspace reads and saves without changing either scope", async () => {
      const home = makeHome();
      process.env.HOME = home;
      const userConfigPath = await writeZcodeUserMcp(home, {
        userOnly: { command: "current-command" },
      });
      const userRaw = await readFile(userConfigPath, "utf-8");
      const workspace = join(home, "workspace");
      const configPath = join(workspace, ".zcode-next", "config.json");
      const raw = await writeObsoleteZcodeMcp(configPath, kind);
      const service = createMcpSyncService();
      const operations = [
        () => service.loadMcpFromUserDirectory({ workspacePath: workspace }),
        ...(["upsert", "delete", "set-enabled"] as const).map(
          (action) => () =>
            service.saveMcpToUserDirectory({
              action,
              source: "zcodeagentmcp",
              name: "context7",
              projectPath: workspace,
              config: { command: "current-command" },
              enabled: true,
            }),
        ),
      ];

      for (const operation of operations) {
        await expect(operation()).rejects.toThrow(
          `Incompatible ZCode Next MCP configuration: ${configPath}. Manually replace obsolete`,
        );
        await expect(readFile(configPath, "utf-8")).resolves.toBe(raw);
        await expect(readFile(userConfigPath, "utf-8")).resolves.toBe(userRaw);
      }
    });
  });

  it("reads current user MCP through all read APIs without rewriting the file", async () => {
    const home = makeHome();
    process.env.HOME = home;
    // 紧凑 JSON 可以揭示读取时发生的格式化写回。
    const configPath = join(home, ".zcode-next", "cli", "config.json");
    await mkdir(join(home, ".zcode-next", "cli"), { recursive: true });
    const raw = JSON.stringify({
      mcp: {
        servers: {
          context7: {
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            enabled: false,
          },
        },
      },
    });
    await writeFile(configPath, raw);
    const service = createMcpSyncService();

    const candidates = await service.listLocalUserMcpCandidates();
    const loaded = await service.loadMcpFromUserDirectory();
    const exported = await service.exportMcpServers({
      serverIds: candidates.candidates.map((candidate) => candidate.id),
    });
    const statuses = await service.listRemoteUserMcpStatuses({ names: ["context7"] });

    expect(candidates.candidates[0]?.enabled).toBe(false);
    expect(loaded.servers[0]?.enabled).toBe(false);
    expect(exported.servers[0]?.enabled).toBe(false);
    expect(statuses.statuses).toEqual([{ name: "context7", exists: true, path: configPath }]);
    await expect(readFile(configPath, "utf-8")).resolves.toBe(raw);
  });

  it("checks remote MCP config directory write access before sync", async () => {
    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const service = createMcpSyncService();

    const result = await service.checkRemoteUserMcpWriteAccess();

    expect(result).toMatchObject({
      ok: true,
      path: join(remoteHome, ".zcode-next", "cli"),
    });
  });

  it("reports remote MCP write preflight failure when cli path is not a directory", async () => {
    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    await mkdir(join(remoteHome, ".zcode-next"), { recursive: true });
    await writeFile(join(remoteHome, ".zcode-next", "cli"), "not a directory");
    const service = createMcpSyncService();

    const result = await service.checkRemoteUserMcpWriteAccess();

    expect(result.ok).toBe(false);
    expect(result.path).toBe(join(remoteHome, ".zcode-next", "cli"));
    expect(result.error).toBeTruthy();
  });

  it.each([
    { configFlags: { enable: false }, enabled: true },
    { configFlags: { enable: true, enabled: false }, enabled: false },
  ])(
    "reads third-party agents MCP using current enabled=$enabled without rewriting it",
    async ({ configFlags, enabled }) => {
      const home = makeHome();
      process.env.HOME = home;
      const configPath = await writeAgentsUserMcp(home, {
        docs: {
          type: "http",
          url: "https://mcp.example.com/mcp",
          ...configFlags,
        },
      });
      const raw = await readFile(configPath, "utf-8");
      const service = createMcpSyncService();

      const result = await service.listLocalUserMcpCandidates();
      const loaded = await service.loadMcpFromUserDirectory();
      const exported = await service.exportMcpServers({
        serverIds: result.candidates.map((candidate) => candidate.id),
      });
      const statuses = await service.listRemoteUserMcpStatuses({ names: ["docs"] });

      expect(result.candidates).toMatchObject([
        {
          name: "docs",
          source: "agents",
          path: configPath,
          config: configFlags,
          enabled,
        },
      ]);
      expect(loaded.servers[0]).toMatchObject({ name: "docs", config: configFlags, enabled });
      expect(exported.servers[0]).toMatchObject({ name: "docs", config: configFlags, enabled });
      expect(statuses.statuses).toEqual([{ name: "docs", exists: true, path: configPath }]);
      await expect(readFile(configPath, "utf-8")).resolves.toBe(raw);
      await expect(stat(join(home, ".zcode-next"))).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each([true, false])(
    "rejects obsolete upsert and import input before writing (existing file: %s)",
    async (existingFile) => {
      const home = makeHome();
      process.env.HOME = home;
      const configPath = join(home, ".zcode-next", "cli", "config.json");
      if (existingFile) {
        await writeZcodeUserMcp(home, { current: { command: "current-command", enabled: false } });
      }
      const raw = existingFile ? await readFile(configPath, "utf-8") : undefined;
      const service = createMcpSyncService();
      const config = { command: "obsolete-command", enable: false };
      const operations = [
        () =>
          service.saveMcpToUserDirectory({
            action: "upsert",
            source: "zcodeagentmcp",
            name: "obsolete",
            config,
          }),
        () =>
          service.importMcpServers({
            servers: [
              {
                id: "obsolete",
                name: "obsolete",
                source: "zcode",
                path: "/local/.zcode-next/cli/config.json",
                config,
                enabled: true,
              },
            ],
            localHomeDir: "/local",
            overwrite: false,
          }),
      ];

      for (const operation of operations) {
        await expect(operation()).rejects.toThrow(
          `Incompatible ZCode Next MCP configuration: ${configPath}. Manually replace obsolete`,
        );
        if (existingFile) {
          await expect(readFile(configPath, "utf-8")).resolves.toBe(raw);
        } else {
          await expect(stat(join(home, ".zcode-next"))).rejects.toMatchObject({ code: "ENOENT" });
        }
      }
      expect(config).toEqual({ command: "obsolete-command", enable: false });
    },
  );

  it("toggles workspace MCP without cleaning up an unrelated user config", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const workspace = join(home, "workspace");
    const service = createMcpSyncService();
    await service.saveMcpToUserDirectory({
      action: "upsert",
      source: "zcodeagentmcp",
      name: "context7",
      projectPath: workspace,
      config: { command: "current-command" },
    });
    const userConfigPath = join(home, ".zcode-next", "cli", "config.json");
    const raw = JSON.stringify({
      mcp: {
        [join(workspace, ".zcode-next")]: { context7: false },
      },
    });
    await mkdir(dirname(userConfigPath), { recursive: true });
    await writeFile(userConfigPath, raw);

    await service.saveMcpToUserDirectory({
      action: "set-enabled",
      source: "zcodeagentmcp",
      name: "context7",
      projectPath: workspace,
      enabled: false,
    });

    const saved = JSON.parse(
      await readFile(join(workspace, ".zcode-next", "config.json"), "utf-8"),
    );
    expect(saved.mcp.servers.context7).toEqual({ command: "current-command", enabled: false });
    await expect(readFile(userConfigPath, "utf-8")).resolves.toBe(raw);
  });

  it("imports stdio and HTTP MCP servers while preserving secrets", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    await writeZcodeUserMcp(localHome, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        env: { CONTEXT7_API_KEY: "secret-local" },
      },
      docsApi: {
        type: "http",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer secret-token" },
        enabled: false,
      },
    });
    const localService = createMcpSyncService();
    const candidates = await localService.listLocalUserMcpCandidates();
    const exported = await localService.exportMcpServers({
      serverIds: candidates.candidates.map((candidate) => candidate.id),
    });

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const remoteService = createMcpSyncService();
    const result = await remoteService.importMcpServers({
      servers: exported.servers,
      localHomeDir: exported.localHomeDir,
      remoteWorkspacePath: "/home/dev/project",
      overwrite: false,
    });

    expect(result.results).toMatchObject([
      { name: "context7", status: "synced" },
      { name: "docsApi", status: "synced" },
    ]);
    const remoteServers = await readRemoteZcodeServers(remoteHome);
    expect(remoteServers.context7).toMatchObject({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: { CONTEXT7_API_KEY: "secret-local" },
    });
    expect(remoteServers.docsApi).toMatchObject({
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer secret-token" },
      enabled: false,
    });
  });

  it("creates imported remote MCP config with owner-only permissions", async () => {
    if (process.platform === "win32") {
      return;
    }

    const previousUmask = process.umask(0o000);
    try {
      const remoteHome = makeHome();
      process.env.HOME = remoteHome;
      const remoteService = createMcpSyncService();

      await remoteService.importMcpServers({
        servers: [
          {
            id: "docs-api",
            name: "docsApi",
            source: "zcode",
            path: "/Users/local/.zcode-next/cli/config.json",
            enabled: true,
            config: {
              type: "http",
              url: "https://mcp.example.com/mcp",
              headers: { Authorization: "Bearer secret-token" },
            },
          },
        ],
        localHomeDir: "/Users/local",
        overwrite: false,
      });

      const configMode = (await stat(join(remoteHome, ".zcode-next", "cli", "config.json"))).mode;
      expect(configMode & 0o777).toBe(0o600);
    } finally {
      process.umask(previousUmask);
    }
  });

  it("fails remote import without overwriting an invalid zcode config file", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    await writeZcodeUserMcp(localHome, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      },
    });
    const localService = createMcpSyncService();
    const candidates = await localService.listLocalUserMcpCandidates();
    const exported = await localService.exportMcpServers({
      serverIds: candidates.candidates.map((candidate) => candidate.id),
    });

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const invalidConfigPath = join(remoteHome, ".zcode-next", "cli", "config.json");
    await mkdir(join(remoteHome, ".zcode-next", "cli"), { recursive: true });
    await writeFile(invalidConfigPath, '{"mcp":');
    const remoteService = createMcpSyncService();

    await expect(
      remoteService.importMcpServers({
        servers: exported.servers,
        localHomeDir: exported.localHomeDir,
        remoteWorkspacePath: "/home/dev/project",
        overwrite: false,
      }),
    ).rejects.toThrow(/config\.json/);
    await expect(readFile(invalidConfigPath, "utf-8")).resolves.toBe('{"mcp":');
  });

  it("loads and saves user MCP through the service on the current host", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const service = createMcpSyncService();

    await service.saveMcpToUserDirectory({
      action: "upsert",
      source: "zcodeagentmcp",
      name: "deepwiki",
      config: {
        type: "http",
        url: "https://mcp.deepwiki.com/mcp",
      },
    });

    const result = await service.loadMcpFromUserDirectory();

    expect(result.servers).toMatchObject([
      {
        source: "zcodeagentmcp",
        scope: "user",
        name: "deepwiki",
        config: {
          type: "http",
          url: "https://mcp.deepwiki.com/mcp",
        },
      },
    ]);
    expect(result.servers[0]?.file?.filePath).toBe(join(home, ".zcode-next", "cli", "config.json"));
  });

  it("loads workspace MCP before user MCP using the same directory precedence", async () => {
    const home = makeHome();
    const workspace = join(home, "workspace");
    process.env.HOME = home;
    await writeZcodeUserMcp(home, {
      userOnly: { type: "http", url: "https://user.example.test/mcp" },
    });
    await mkdir(join(workspace, ".zcode-next"), { recursive: true });
    await writeFile(
      join(workspace, ".zcode-next", "config.json"),
      JSON.stringify(
        {
          mcp: {
            servers: {
              workspaceOnly: {
                type: "http",
                url: "https://workspace.example.test/mcp",
                enabled: false,
              },
            },
          },
        },
        null,
        2,
      ),
    );
    const workspaceConfigPath = join(workspace, ".zcode-next", "config.json");
    const workspaceRaw = await readFile(workspaceConfigPath, "utf-8");
    const service = createMcpSyncService();

    const result = await service.loadMcpFromUserDirectory({ workspacePath: workspace });

    expect(result.servers.map((server) => `${server.scope}:${server.name}`)).toEqual([
      "workspace:workspaceOnly",
      "user:userOnly",
    ]);
    expect(result.servers[0]?.enabled).toBe(false);
    await expect(readFile(workspaceConfigPath, "utf-8")).resolves.toBe(workspaceRaw);
  });

  it("rewrites filesystem MCP home and workspace paths for the remote host", async () => {
    const localHome = makeHome();
    const localWorkspacePath = join(localHome, "workspace", "z-code");
    process.env.HOME = localHome;
    await writeZcodeUserMcp(localHome, {
      filesystem: {
        type: "stdio",
        command: "npx",
        args: [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          join(localWorkspacePath, "src"),
          join(localHome, "Documents"),
        ],
      },
    });
    const localService = createMcpSyncService();
    const candidates = await localService.listLocalUserMcpCandidates();
    const exported = await localService.exportMcpServers({
      serverIds: candidates.candidates.map((candidate) => candidate.id),
    });

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const remoteService = createMcpSyncService();
    await remoteService.importMcpServers({
      servers: exported.servers,
      localHomeDir: exported.localHomeDir,
      localWorkspacePath,
      remoteWorkspacePath: "/srv/z-code",
      overwrite: false,
    });

    const remoteServers = await readRemoteZcodeServers(remoteHome);
    expect(remoteServers.filesystem?.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/srv/z-code/src",
      join(remoteHome, "Documents"),
    ]);
  });

  it("skips same-name remote MCP servers without overwriting", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    await writeZcodeUserMcp(localHome, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      },
    });
    const localService = createMcpSyncService();
    const candidates = await localService.listLocalUserMcpCandidates();
    const exported = await localService.exportMcpServers({
      serverIds: candidates.candidates.map((candidate) => candidate.id),
    });

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    await writeZcodeUserMcp(remoteHome, {
      context7: {
        type: "stdio",
        command: "existing-command",
      },
    });
    const remoteService = createMcpSyncService();

    const result = await remoteService.importMcpServers({
      servers: exported.servers,
      localHomeDir: exported.localHomeDir,
      remoteWorkspacePath: "/home/dev/project",
      overwrite: false,
    });

    expect(result.results).toEqual([
      {
        name: "context7",
        status: "skipped",
        path: join(remoteHome, ".zcode-next", "cli", "config.json"),
      },
    ]);
    const remoteServers = await readRemoteZcodeServers(remoteHome);
    expect(remoteServers.context7).toMatchObject({
      command: "existing-command",
    });
  });
});
