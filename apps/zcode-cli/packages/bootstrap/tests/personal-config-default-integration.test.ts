import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { SharedZCodeCredentialStore } from "@zcode/adapters/auth";
import { createSharedZCodeCredentialStore } from "@zcode/adapters/auth";
import { NodePersonalProviderConfigRepository } from "@zcode/provider-node";
import { ProviderConfig } from "@zcode/provider";
import { configureCodingPlanApiKey } from "../src/auth-login.js";
import { startProcessProviderRegistryRuntime } from "../src/app/process-provider-registry-runtime.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Todo104 CLI 同文件默认选择", () => {
  it("登录沿用注入的 Personal 路径，更新默认选择不覆盖 Provider 内容", async () => {
    const directory = await mkdtemp(join(tmpdir(), "todo104-cli-login-"));
    directories.push(directory);
    const personalPath = join(directory, "injected-personal.json");
    const env = {
      ZCODE_CREDENTIAL_SECRET: "todo104-fixture-only",
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: personalPath,
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: fileURLToPath(
        new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url),
      ),
    };
    const repository = new NodePersonalProviderConfigRepository({
      filePath: personalPath,
      pollingIntervalMs: false,
    });
    try {
      await repository.update((current) => ({
        ...current,
        providers: current.providers.setRule({
          providerId: "custom",
          providerName: "Keep Me",
          config: new ProviderConfig({ personalModelIds: ["model-a"] }),
        }),
      }));
      const credentialStore = createSharedZCodeCredentialStore({
        baseDir: join(directory, "credentials"),
        env,
      });
      const result = await configureCodingPlanApiKey({
        apiKey: "fixture-key",
        providerId: "bigmodel",
        credentialStore,
        env,
      });
      expect(result.configPath).toBe(personalPath);
      const stored = await repository.read();
      expect(stored.defaultModelSelection?.providerId).toBe(
        "account:bigmodel-individual-coding-plan",
      );
      expect(stored.providers.getRule("custom")?.providerName).toBe("Keep Me");
      expect(stored.providers.get("custom")?.personalModelIds).toEqual(["model-a"]);
    } finally {
      repository.dispose();
    }
  });
  it("Standalone restart and clearing defaults use only the current Personal Config", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-cli-personal-current-"));
    directories.push(directory);
    const personalPath = join(directory, "provider_config.json");
    const env = {
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: fileURLToPath(
        new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url),
      ),
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: personalPath,
    };
    const credentialStore = { loadMany: async () => ({}) } as unknown as SharedZCodeCredentialStore;
    const repository = new NodePersonalProviderConfigRepository({
      filePath: personalPath,
      pollingIntervalMs: false,
    });
    try {
      await repository.update((current) => ({
        ...current,
        defaultModelSelection: { providerId: "fixture", modelId: "model-a" },
      }));
    } finally {
      repository.dispose();
    }
    const standalone = await startProcessProviderRegistryRuntime(env, {
      standalone: { credentialStore },
    });
    try {
      expect(standalone.configuredDefaultModelSelection).toEqual({
        providerId: "fixture",
        modelId: "model-a",
      });
      await standalone.modelSelectionConfigRepository.saveConfiguredDefault(undefined);
    } finally {
      standalone.dispose();
    }
    const restart = await startProcessProviderRegistryRuntime(env, {
      standalone: { credentialStore },
    });
    try {
      expect(restart.configuredDefaultModelSelection).toBeUndefined();
    } finally {
      restart.dispose();
    }
  });
});
