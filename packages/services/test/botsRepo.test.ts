import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BotsRepo } from "../src/bots/repo.js";
import { setDataBaseDir } from "../src/paths.js";

describe("BotsRepo", () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "zcode-bots-repo-"));
    setDataBaseDir(tempDir);
  });

  afterEach(() => {
    setDataBaseDir(null);
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("uses current bot files without importing or modifying obsolete files", async () => {
    const dataDir = join(tempDir!, ".zcode-next", "v2");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "bot-state.json"),
      `${JSON.stringify({
        version: 2,
        bots: {
          "feishu-1": {
            botId: "feishu-1",
            workspacePath: "/tmp/workspace",
            mode: "draft",
            activeTaskId: null,
            draftOptions: {
              provider: "glm",
              model: "custom:old-provider:deepseek-v4-flash",
            },
            updatedAt: 1,
          },
        },
      })}\n`,
    );

    const repo = new BotsRepo();

    await expect(repo.readState()).resolves.toEqual({ version: 3, bots: {} });
    await expect(repo.readConfig()).resolves.toEqual({ version: 3, bots: [] });

    await repo.writeState({ version: 3, bots: {} });

    expect(existsSync(join(dataDir, "bot-state.json"))).toBe(true);
    expect(existsSync(join(dataDir, "bot-state.v3.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dataDir, "bot-state.json"), "utf-8"))).toMatchObject({
      bots: {
        "feishu-1": {
          draftOptions: {
            model: "custom:old-provider:deepseek-v4-flash",
          },
        },
      },
    });
  });

  it("preserves current bot configuration and state across instances", async () => {
    const repo = new BotsRepo();
    const state = {
      version: 3 as const,
      bots: {
        bot: {
          botId: "bot",
          workspacePath: "/project",
          mode: "draft" as const,
          activeTaskId: null,
          draftOptions: {
            provider: "glm" as const,
            modelSelection: { providerId: "proxy", modelId: "model" },
          },
          updatedAt: 1,
        },
      },
    };
    await repo.writeState(state);
    await expect(new BotsRepo().readState()).resolves.toEqual(state);
  });

  it("rejects an incompatible current file with its path and leaves it intact", async () => {
    const path = join(tempDir!, ".zcode-next", "v2", "bot-state.v3.json");
    mkdirSync(join(tempDir!, ".zcode-next", "v2"), { recursive: true });
    const raw = JSON.stringify({ version: 2, bots: {} });
    writeFileSync(path, raw);
    await expect(new BotsRepo().readState()).rejects.toThrow(path);
    await expect(new BotsRepo().readState()).rejects.toThrow("back up and move only this file");
    expect(readFileSync(path, "utf8")).toBe(raw);
  });
});
