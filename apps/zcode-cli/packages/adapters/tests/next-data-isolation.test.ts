import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSharedZCodeCredentialStore,
  loadSharedZCodeCredentialSync,
  SHARED_ZCODE_CREDENTIAL_KEYS,
} from "../src/auth/index.js";
import { createNodeCustomCommandAdapter } from "../src/commands/index.js";
import { loadFileConfig } from "../src/config/file-config.adapter.js";
import { loadProjectConfigs } from "../src/config/project-config.adapter.js";
import { createNodeContextSourceAdapter } from "../src/context/index.js";
import { ensureCliDeviceMid } from "../src/device/cli-device-mid.js";
import { createNodeSkillAdapter } from "../src/skills/index.js";

let home: string;
let workspace: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "zcode-next-isolation-"));
  workspace = join(home, "workspace");
  await mkdir(join(workspace, ".git"), { recursive: true });
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { force: true, recursive: true });
});

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

describe("Next data isolation", () => {
  it("ignores upstream user and project config even when Next config is absent", async () => {
    const oldConfig = JSON.stringify({ ui: { locale: "zh-CN" } });
    await writeText(join(home, ".zcode", "cli", "config.json"), oldConfig);
    await writeText(join(workspace, ".zcode", "config.json"), oldConfig);
    await writeText(join(workspace, "zcode.json"), oldConfig);

    expect(loadFileConfig()).toMatchObject({
      loaded: false,
      path: join(home, ".zcode-next", "cli", "config.json"),
    });
    expect(loadProjectConfigs(workspace)).toMatchObject({
      diagnostics: [],
      loaded: false,
      paths: [],
    });

    const nextUserConfig = join(home, ".zcode-next", "cli", "config.json");
    const nextProjectConfig = join(workspace, "zcode-next.json");
    const nextHiddenConfig = join(workspace, ".zcode-next", "config.json");
    await writeText(nextUserConfig, JSON.stringify({ ui: { locale: "en-US" } }));
    await writeText(nextProjectConfig, JSON.stringify({ ui: { locale: "en-US" } }));
    await writeText(nextHiddenConfig, JSON.stringify({ ui: { theme: "dark" } }));

    expect(loadFileConfig().config.ui?.locale).toBe("en-US");
    expect(loadProjectConfigs(workspace).paths).toEqual([nextProjectConfig, nextHiddenConfig]);
    expect(await readFile(join(workspace, "zcode.json"), "utf8")).toBe(oldConfig);
  });

  it("honors explicit config files without upstream directory conventions", async () => {
    const oldProjectConfig = join(workspace, ".zcode", "config.json");
    await writeText(
      oldProjectConfig,
      JSON.stringify({ plugins: { dirs: ["./plugins"] }, ui: { locale: "zh-CN" } }),
    );
    const discovered = loadProjectConfigs(workspace, oldProjectConfig);
    expect(discovered.paths).toEqual([oldProjectConfig]);
    expect(discovered.files[0]?.baseDir).toBe(join(workspace, ".zcode"));
    expect(discovered.files[0]?.config.plugins?.dirs).toEqual(["./plugins"]);
    expect(loadFileConfig(oldProjectConfig).config.ui?.locale).toBe("zh-CN");
  });

  it("starts with fresh credentials and leaves upstream credentials intact", async () => {
    const key = SHARED_ZCODE_CREDENTIAL_KEYS.zaiAccessToken;
    const oldPath = join(home, ".zcode", "v2", "credentials.json");
    const oldContent = JSON.stringify({ [key]: "upstream-token" });
    await writeText(oldPath, oldContent);
    const options = { env: { ZCODE_DATA_BASE_DIR: home, ZCODE_CREDENTIAL_SECRET: "test-secret" } };
    const store = createSharedZCodeCredentialStore(options);

    await expect(store.load(key)).resolves.toBeNull();
    expect(loadSharedZCodeCredentialSync(key, options)).toBeUndefined();
    await store.save(key, "next-token");
    expect(store.filePath).toBe(join(home, ".zcode-next", "v2", "credentials.json"));
    await expect(createSharedZCodeCredentialStore(options).load(key)).resolves.toBe("next-token");
    await expect(
      createSharedZCodeCredentialStore({ ...options, filePath: oldPath }).load(key),
    ).resolves.toBe("upstream-token");
    expect(await readFile(oldPath, "utf8")).toBe(oldContent);
  });

  it("creates a separate device identity without importing upstream identity or telemetry", async () => {
    const oldDirectory = join(home, ".zcode", "v2");
    const oldIdentity = JSON.stringify({ deviceMid: "upstream-device" });
    await writeText(join(oldDirectory, "device-identity.json"), oldIdentity);
    await writeText(join(oldDirectory, "telemetry-state.json"), oldIdentity);
    const options = { env: { ZCODE_DATA_BASE_DIR: home }, createId: () => "next-device" };

    await expect(ensureCliDeviceMid(options)).resolves.toBe("next-device");
    await expect(
      ensureCliDeviceMid({ ...options, createId: () => "unexpected-device" }),
    ).resolves.toBe("next-device");
    expect(
      JSON.parse(await readFile(join(home, ".zcode-next", "v2", "device-identity.json"), "utf8")),
    ).toEqual({ deviceMid: "next-device" });
    expect(await readFile(join(oldDirectory, "device-identity.json"), "utf8")).toBe(oldIdentity);
    expect(await readFile(join(oldDirectory, "telemetry-state.json"), "utf8")).toBe(oldIdentity);
  });

  it("discovers Next and .agents skills and commands without discovering upstream roots", async () => {
    for (const [base, scope] of [[home, "user"], [workspace, "project"]] as const) {
      for (const [directory, kind] of [
        [".zcode", "upstream"],
        [".zcode-next", "next"],
        [".agents", "shared"],
      ] as const) {
        const name = `${scope}-${kind}`;
        await writeText(
          join(base, directory, "skills", name, "SKILL.md"),
          `---\nname: ${name}\ndescription: ${name} skill\n---\nSkill body`,
        );
        await writeText(join(base, directory, "commands", `${name}.md`), "Command body");
      }
    }
    const options = { homeDirectory: home };
    const skills = await createNodeSkillAdapter(options).discoverSkills({
      workingDirectory: workspace,
    });
    const commands = await createNodeCustomCommandAdapter(options).discoverCommands({
      workingDirectory: workspace,
    });
    const expectedNames = ["project-next", "project-shared", "user-next", "user-shared"];
    expect(skills.skills.map((skill) => skill.name).sort()).toEqual(expectedNames);
    expect(commands.commands.map((command) => command.name).sort()).toEqual(expectedNames);
  });

  it("loads Next user instructions without falling back to upstream instructions", async () => {
    await writeText(join(home, ".zcode", "AGENTS.md"), "Upstream instructions");
    const adapter = createNodeContextSourceAdapter({ env: { HOME: home, USERPROFILE: home } });
    const input = {
      workingDirectory: workspace,
      userInstructions: { workingDirectory: workspace },
    };
    expect((await adapter.resolveContextSources(input)).userInstructions).toBeUndefined();
    await writeText(join(home, ".zcode-next", "AGENTS.md"), "Next instructions");
    expect((await adapter.resolveContextSources(input)).userInstructions?.content).toBe(
      "Next instructions",
    );
  });
});
