import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appSettingsSchema, type ProviderFamilyConnectionSelectionSettings } from "@zcode/shared";

const originalHome = process.env.HOME;
const originalDesktopHome = process.env.ZCODE_DESKTOP_HOME_DIR;
const homes: string[] = [];

async function setup(raw: unknown, desktopHomeOverride = false) {
  const home = await mkdtemp(join(tmpdir(), "zcode-account-settings-"));
  homes.push(home);
  process.env.HOME = home;
  const settingsHome = desktopHomeOverride ? join(home, "desktop-home") : home;
  if (desktopHomeOverride) process.env.ZCODE_DESKTOP_HOME_DIR = settingsHome;
  else delete process.env.ZCODE_DESKTOP_HOME_DIR;
  const directory = join(settingsHome, ".zcode-next", "v2");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "setting.json");
  const text = JSON.stringify(raw);
  await writeFile(file, text);
  vi.resetModules();
  const { createSettingService } = await import("../src/setting/settingService.js");
  return { home, settingsHome, directory, file, text, createSettingService };
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalDesktopHome === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
  else process.env.ZCODE_DESKTOP_HOME_DIR = originalDesktopHome;
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("current account settings format", () => {
  it.each([
    { modelProviderFamilyModes: { bigmodel: "apiKey" } },
    { modelProviderFamilyModes: { zai: "oauth" } },
    { locale: "en-US" },
    { enabledBuiltinAgentCliProviders: ["claude", "glm"] },
    { lastOpenTabs: ["/workspace/project"] },
    { remoteWorkspaceHistory: [] },
    { lastWorkspaceSession: [{ kind: "remote", historyId: "retired-history" }] },
    {
      lastWorkspaceSession: [
        {
          kind: "remote",
          workspacePath: "/workspace/demo",
          target: { kind: "ssh", host: "example.test", username: "user", resourcePackages: {} },
          lastOpenedAt: 123,
          lastConnectionStatus: "connected",
        },
      ],
    },
    {
      modelProviderFamilySelectedKeys: {
        bigmodel: "coding-plan:builtin:bigmodel-coding-plan",
      },
    },
    {
      modelProviderFamilySelectedKeys: {
        bigmodel: "team-plan:builtin:bigmodel-coding-plan:product:project",
      },
    },
    {
      modelProviderFamilySelectedKeys: {
        bigmodel: "team-plan:builtin:bigmodel-coding-plan:product:organization:project",
      },
    },
  ])("rejects obsolete account settings without changing or quarantining them: %j", async (raw) => {
    const { directory, file, text, createSettingService } = await setup(raw, true);
    const service = createSettingService();
    const failure = expect.objectContaining({
      code: "INCOMPATIBLE_SETTINGS_FORMAT",
      settingsFile: file,
      message: expect.stringContaining(`back up and remove only "${file}"`),
    });

    await expect(service.get()).rejects.toEqual(failure);
    await expect(service.update({ locale: "en-US" })).rejects.toEqual(failure);
    expect(await readFile(file, "utf8")).toBe(text);
    expect(await readdir(directory)).toEqual(["setting.json"]);
  });

  it("recovers the write queue after manual settings reset and preserves project/workspace files", async () => {
    const { home, settingsHome, file, text, createSettingService } = await setup({
      modelProviderFamilySelectedKeys: {
        bigmodel: "team-plan:builtin:bigmodel-coding-plan:product:project",
      },
    });
    const project = join(home, "project");
    const workspace = join(settingsHome, ".zcode-next", "workspace", "default");
    await mkdir(project, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const sourceFile = join(project, "source.ts");
    const workspaceFile = join(workspace, "notes.md");
    await writeFile(sourceFile, "export const value = 1;\n");
    await writeFile(workspaceFile, "workspace content\n");
    const service = createSettingService();

    await expect(service.update({ locale: "en-US" })).rejects.toThrow(
      "Keep project and workspace files unchanged",
    );
    expect(await readFile(file, "utf8")).toBe(text);
    await rename(file, `${file}.manual-backup`);
    await service.update({ locale: "en-US" });

    await expect(service.get()).resolves.toMatchObject({
      locale: "en-US",
      providerFamilyConnectionSelections: {},
    });
    expect(await readFile(`${file}.manual-backup`, "utf8")).toBe(text);
    expect(await readFile(sourceFile, "utf8")).toBe("export const value = 1;\n");
    expect(await readFile(workspaceFile, "utf8")).toBe("workspace content\n");
  });

  it.each([
    {},
    { bigmodel: { kind: "start-plan" } },
    { bigmodel: { kind: "individual-coding-plan" } },
    {
      bigmodel: {
        kind: "team-coding-plan",
        productId: "product",
        organizationId: "organization",
        projectId: "project",
      },
    },
  ] satisfies ProviderFamilyConnectionSelectionSettings[])(
    "keeps current connection %j and drops obsolete rollback fields on save",
    async (selections) => {
      const { file, text, createSettingService } = await setup({
        ...appSettingsSchema.parse({}),
        providerFamilyDomain: "bigmodel",
        providerFamilyConnectionSelections: selections,
        modelProviderFamilyModes: { bigmodel: "oauth" },
        modelProviderFamilySelectedKeys: {
          bigmodel: "coding-plan:builtin:bigmodel-start-plan",
        },
      });
      const service = createSettingService();

      expect((await service.get()).providerFamilyConnectionSelections).toEqual(selections);
      expect(await readFile(file, "utf8")).toBe(text);
      await service.update({ locale: "en-US" });
      const saved = JSON.parse(await readFile(file, "utf8"));
      expect(saved.providerFamilyConnectionSelections).toEqual(selections);
      expect(saved).not.toHaveProperty("modelProviderFamilyModes");
      expect(saved).not.toHaveProperty("modelProviderFamilySelectedKeys");

      await service.update({ providerFamilyConnectionSelections: {} });
      await expect(createSettingService().get()).resolves.toMatchObject({
        locale: "en-US",
        providerFamilyConnectionSelections: {},
      });
    },
  );
});
