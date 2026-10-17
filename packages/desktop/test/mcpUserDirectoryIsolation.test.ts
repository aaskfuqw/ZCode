import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  loadCliMcpFromUserDirectory,
  saveCliMcpToUserDirectory,
} from "../src/main/mcpUserDirectory/index.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("loads and saves current MCP data without importing or modifying upstream profiles", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-next-mcp-isolation-"));
  roots.push(root);
  vi.stubEnv("HOME", root);
  vi.stubEnv("APPDATA", root);
  vi.stubEnv("LOCALAPPDATA", root);
  const profile = join(root, "ai.z.zcode");
  const upstreamFile = join(profile, "store.json");
  const servers = { demo: { command: "demo-mcp", args: [] } };
  const content = JSON.stringify({
    "mcp-storage": JSON.stringify({ state: { config: { mcp: { mcpServers: servers } } } }),
  });
  await mkdir(profile, { recursive: true });
  await writeFile(upstreamFile, content);
  const levelDbDirectory = join(profile, "Local Storage", "leveldb");
  const levelDbFile = join(levelDbDirectory, "000001.ldb");
  const levelDbContent = `mcp-config ${JSON.stringify({ mcp: { mcpServers: servers } })}`;
  await mkdir(levelDbDirectory, { recursive: true });
  await writeFile(levelDbFile, levelDbContent);

  const currentDirectory = join(root, ".zcode-next", "cli");
  const currentFile = join(currentDirectory, "config.json");
  const currentServer = { command: "current-mcp", args: [], enabled: false };
  const currentContent = JSON.stringify({
    model: "current-model",
    mcp: { servers: { current: currentServer } },
  });
  await mkdir(currentDirectory, { recursive: true });
  await writeFile(currentFile, currentContent);

  const loaded = await loadCliMcpFromUserDirectory();
  expect(loaded.servers).toEqual([
    expect.objectContaining({ name: "current", config: currentServer, enabled: false }),
  ]);
  expect(await readFile(currentFile, "utf8")).toBe(currentContent);

  const addedServer = { command: "added-mcp", args: [] };
  await saveCliMcpToUserDirectory({
    action: "upsert",
    source: "zcodeagentmcp",
    name: "added",
    config: addedServer,
  });
  expect(JSON.parse(await readFile(currentFile, "utf8"))).toEqual({
    model: "current-model",
    mcp: { servers: { current: currentServer, added: addedServer } },
  });
  expect(await readFile(upstreamFile, "utf8")).toBe(content);
  expect(await readFile(levelDbFile, "utf8")).toBe(levelDbContent);
});
