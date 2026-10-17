import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createConfig } from "../src/config/index.js";
import { loadFileConfig } from "../src/config/file-config.adapter.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const currentServer = { type: "stdio", command: "node", args: ["fixture.mjs"] };
const obsoleteMcpConfigs = [
  ["disabled enable field", { servers: { fixture: { ...currentServer, enable: false } } }],
  ["enabled enable field", { servers: { fixture: { ...currentServer, enable: true } } }],
  [
    "conflicting disable",
    { servers: { fixture: { ...currentServer, enable: false, enabled: true } } },
  ],
  [
    "conflicting enable",
    { servers: { fixture: { ...currentServer, enable: true, enabled: false } } },
  ],
  ["matching flags", { servers: { fixture: { ...currentServer, enable: true, enabled: true } } }],
  ["invalid enable value", { servers: { fixture: { ...currentServer, enable: null } } }],
  ["directory list override", { dirs: ["./obsolete-mcp"], servers: { fixture: currentServer } }],
  [
    "config directory override",
    { configDir: "./obsolete-mcp", servers: { fixture: currentServer } },
  ],
  ["config file override", { configFile: "./obsolete-mcp.json" }],
] as const;

it.each(obsoleteMcpConfigs)(
  "rejects an obsolete MCP %s at the raw file boundary without writing",
  async (_name, mcp) => {
    const root = await mkdtemp(join(tmpdir(), "zcode-obsolete-mcp-config-"));
    roots.push(root);
    const path = join(root, "overridden-config.json");
    const content = JSON.stringify({ mcp, ui: { locale: "zh-CN" } }, null, 4);
    await writeFile(path, content);

    const load = () => loadFileConfig(relative(process.cwd(), path));
    expect(load).toThrow(`Incompatible ZCode Next MCP configuration: ${path}.`);
    expect(load).toThrow("Manually replace obsolete server enable fields with enabled");
    expect(load).toThrow("remove old directory overrides from mcp");
    expect(load).toThrow(
      "Keep the current mcp.servers entries, unrelated configuration, project and workspace files",
    );
    expect(await readFile(path, "utf8")).toBe(content);
    expect(await readdir(root)).toEqual(["overridden-config.json"]);
  },
);

it("rejects obsolete MCP in an explicit project config with its actual path and preserves the file", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-obsolete-project-mcp-config-"));
  roots.push(root);
  const path = join(root, "project-config.json");
  const content = JSON.stringify({
    mcp: { servers: { fixture: { ...currentServer, enable: false } } },
    plugins: { enabledPlugins: { "fixture@marketplace": true } },
  });
  await writeFile(path, content);
  expect(() =>
    createConfig({
      env: {},
      skipUserConfig: true,
      projectConfigPath: relative(process.cwd(), path),
    }),
  ).toThrow(`Incompatible ZCode Next MCP configuration: ${path}.`);
  expect(await readFile(path, "utf8")).toBe(content);
});
