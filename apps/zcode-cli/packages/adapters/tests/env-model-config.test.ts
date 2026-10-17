import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConfig, parseEnvConfig } from "../src/config/index.js";

describe("env model config", () => {
  it("ignores legacy model environment variables", () => {
    const config = parseEnvConfig({
      ZCODE_API_KEY: "secret",
      ZCODE_BASE_URL: "https://api.example.test/anthropic",
      ZCODE_MODEL: "glm-5.1",
    });

    expect(config).not.toHaveProperty("model");
  });

  it("does not validate legacy model environment variables", () => {
    const config = parseEnvConfig({
      ZCODE_BASE_URL: "https://api.z.ai/api/anthropic",
      ZCODE_MODEL: "zai/",
    });

    expect(config).not.toHaveProperty("model");
  });

  it("rejects obsolete file model config with its actual path and manual recovery guidance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-env-model-"));
    const path = join(dir, "config.json");

    try {
      await writeFile(
        path,
        JSON.stringify({
          model: "fixture/model",
          provider: { fixture: { kind: "openai-compatible" } },
        }),
      );

      const load = () =>
        createConfig({
          env: {
            ZCODE_BASE_URL: "https://api.env.example/anthropic",
            ZCODE_MODEL: "env-model",
          },
          userConfigPath: path,
        });

      expect(load).toThrow(path);
      expect(load).toThrow("provider_config.json");
      expect(load).toThrow("manually remove the obsolete model/provider keys");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
