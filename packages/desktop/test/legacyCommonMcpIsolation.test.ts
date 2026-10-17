import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { migrateLegacyCommonMcp } from "../src/main/mcpUserDirectory/legacy.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("does not discover upstream MCP profiles, while honoring explicit file selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-next-mcp-isolation-"));
  roots.push(root);
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

  expect(await migrateLegacyCommonMcp()).toEqual({
    servers: {},
    totalCount: 0,
    importedCount: 0,
    skippedCount: 0,
  });
  expect(await migrateLegacyCommonMcp({ legacyStorageDir: upstreamFile })).toMatchObject({
    servers,
    totalCount: 1,
    sourcePath: upstreamFile,
  });
  expect(await readFile(upstreamFile, "utf8")).toBe(content);
});
