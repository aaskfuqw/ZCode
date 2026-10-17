import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelConfigRules, ProviderConfigMap, ProviderTemplateMap } from "@zcode/provider";
import { createProviderConfigRuntime } from "../src/model-provider/providerConfigRuntime.js";
import { setDataBaseDir } from "../src/paths.js";

const roots: string[] = [];
async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
afterEach(async () => {
  setDataBaseDir(null);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function emptyBuiltinRelease(revision = 1) {
  return {
    schemaVersion: 1,
    revision,
    config: {
      providerConfigRules: { providerRules: [], templateRules: [] },
      modelConfigRules: {
        modelRules: [],
        modelApiRules: [],
        providerSiteRules: [],
        templateModelRules: [],
        builtinProviderModelRules: [],
      },
    },
  } as const;
}

describe("ProviderConfigRuntime", () => {
  it("reads an empty current config without importing adjacent historical config.json", async () => {
    const root = await makeRoot("zcode-provider-current-");
    const configDir = join(root, ".zcode-next", "v2");
    const builtin = join(root, "builtin.json");
    const obsolete = join(configDir, "config.json");
    const personal = join(configDir, "provider_config.json");
    const obsoleteText = JSON.stringify({
      provider: { retired: { apiKey: "unused-fixture-key" } },
    });
    await mkdir(configDir, { recursive: true });
    await writeFile(builtin, JSON.stringify(emptyBuiltinRelease()));
    await writeFile(obsolete, obsoleteText);
    setDataBaseDir(root);
    const runtime = createProviderConfigRuntime({
      zcodeBuiltinFilePath: builtin,
      personalPollingIntervalMs: false,
      watch: false,
    });
    try {
      await runtime.start();
      expect((await runtime.configService.read()).personalProviders.keys()).toEqual([]);
      await expect(readFile(personal)).rejects.toMatchObject({ code: "ENOENT" });
      await runtime.personalRepository.update(() => ({
        providers: ProviderConfigMap.empty(),
        models: ModelConfigRules.empty(),
      }));
      expect(JSON.parse(await readFile(personal, "utf8")).schemaVersion).toBe(1);
      expect(await readFile(obsolete, "utf8")).toBe(obsoleteText);
    } finally {
      runtime.dispose();
    }
  });

  it.each(["not-json", JSON.stringify({ schemaVersion: 0, provider: {} })])(
    "fails initialization for an incompatible current file and preserves it: %s",
    async (text) => {
      const root = await makeRoot("zcode-provider-incompatible-");
      const builtin = join(root, "builtin.json");
      const personal = join(root, "provider_config.json");
      await writeFile(builtin, JSON.stringify(emptyBuiltinRelease()));
      await writeFile(personal, text);
      const runtime = createProviderConfigRuntime({
        zcodeBuiltinFilePath: builtin,
        personalFilePath: personal,
        personalPollingIntervalMs: false,
        watch: false,
      });
      try {
        await expect(runtime.start()).rejects.toThrow(personal);
        expect(await readFile(personal, "utf8")).toBe(text);
      } finally {
        runtime.dispose();
      }
    },
  );

  it("保留含非法 endpoint 的 Personal Provider，并把问题留给 Registry 完整性校验", async () => {
    const root = await makeRoot("zcode-provider-runtime-");
    const zcodeBuiltinFilePath = join(root, "zcodeBuiltin.json");
    const personalFilePath = join(root, "provider_config.json");
    await writeFile(zcodeBuiltinFilePath, JSON.stringify(emptyBuiltinRelease()), "utf8");
    await writeFile(
      personalFilePath,
      JSON.stringify({
        schemaVersion: 1,
        config: {
          providerConfigRules: {
            providerRules: [
              {
                providerId: "broken",
                config: {
                  group: "standard-personal",
                  access: { type: "api-key", apiKey: "broken-key" },
                  api: { type: "openai-chat-completions", baseUrl: "testtest" },
                  personalModelIds: ["broken-model"],
                },
              },
              {
                providerId: "valid",
                config: {
                  group: "standard-personal",
                  access: { type: "api-key", apiKey: "valid-key" },
                  api: { type: "openai-chat-completions", baseUrl: "https://api.example.com/v1" },
                  personalModelIds: ["valid-model"],
                },
              },
            ],
          },
          modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
        },
      }),
      "utf8",
    );

    const recovery = vi.fn();
    const runtime = createProviderConfigRuntime({
      zcodeBuiltinFilePath,
      personalFilePath,
      personalPollingIntervalMs: false,
      watch: false,
      onPersonalConfigRecovery: recovery,
    });

    try {
      await runtime.start();
      const snapshot = await runtime.configService.read();
      expect(snapshot.personalProviders.keys()).toEqual(["broken", "valid"]);
      expect(recovery).not.toHaveBeenCalled();
    } finally {
      runtime.dispose();
    }
  });

  it("本地候选 ready 后后台同步远端 Release，并把 Active 路径暴露给 Worker", async () => {
    const root = await makeRoot("zcode-provider-runtime-");
    const bundledFilePath = join(root, "bundled.json");
    const activeFilePath = join(root, "cache", "active.json");
    await writeFile(bundledFilePath, JSON.stringify(emptyBuiltinRelease()), "utf8");
    const fetchRelease = vi.fn(async () => ({
      schemaVersion: 1 as const,
      revision: 2,
      config: {
        providerTemplates: ProviderTemplateMap.empty(),
        providers: ProviderConfigMap.empty(),
        modelConfigRules: ModelConfigRules.empty(),
      },
    }));
    const runtime = createProviderConfigRuntime({
      zcodeBuiltinFilePath: bundledFilePath,
      zcodeBuiltinActiveFilePath: activeFilePath,
      personalFilePath: join(root, "personal.json"),
      zcodeBuiltinRemote: {
        controlFilePath: join(root, "cache", "refresh-control.json"),
        resolveEndpointKey: () => "https://example.com",
        fetchRelease,
      },
      watch: false,
    });

    await runtime.start();
    const initial = await runtime.configService.read();
    expect(initial.revision).toContain("zcode-builtin:1");
    await expect(runtime.resolveZCodeBuiltinActiveFilePath()).resolves.toBe(activeFilePath);
    await expect(runtime.refreshZCodeBuiltin({ force: true })).resolves.toBe("updated");
    expect((await runtime.configService.read()).revision).toContain("zcode-builtin:2");
    runtime.dispose();
  });
});
