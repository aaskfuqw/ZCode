import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotsRepo } from "../src/bots/repo.js";
import { setDataBaseDir } from "../src/paths.js";
import * as f from "./botsService.fixtures.js";

describe("Current bot persistence", () => {
  let root: string;
  let dir: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "next-bot-current-"));
    setDataBaseDir(root);
    dir = join(root, ".zcode-next", "v2");
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    setDataBaseDir(null);
    await rm(root, { recursive: true, force: true });
  });

  it("keeps a remote draft's explicit model identity while disconnected", async () => {
    const modelSelection = { providerId: "remote-provider", modelId: "model" };
    await writeFile(
      join(dir, "bot-state.v3.json"),
      JSON.stringify({
        version: 3,
        bots: {
          bot: {
            botId: "bot",
            workspacePath: "/workspace",
            workspaceIdentity: "ssh://remote/workspace",
            mode: "draft",
            activeTaskId: null,
            draftOptions: { provider: "glm", modelSelection },
            updatedAt: 1,
          },
        },
      }),
    );
    const getModelSelectionService = vi.fn();
    const ensureConnected = vi.fn(async () => ({ ok: true }));
    const service = f.createBotsService({
      credentialService: f.createCredentialService({}),
      modelSelectionService: f.createModelSelectionService([]),
      runStartupBackgroundTasks: false,
      remoteWorkspaceService: {
        isConnected: async () => false,
        ensureConnected,
        getModelSelectionService,
      },
    });
    try {
      expect((await service.getBotStates())[0]).toMatchObject({
        workspaceIdentity: "ssh://remote/workspace",
        draftOptions: { modelSelection },
      });
      expect(getModelSelectionService).not.toHaveBeenCalled();
      expect(ensureConnected).not.toHaveBeenCalled();
    } finally {
      await service.disposeAllAndWait();
    }
  });

  it("concurrent first reads initialize one current state and leave retired files intact", async () => {
    const oldPath = join(dir, "bot-state.v2.json");
    const old = JSON.stringify({ version: 2, bots: { retired: { model: "old" } } });
    await writeFile(oldPath, old);
    const repo = new BotsRepo();
    expect(await Promise.all([repo.readState(), repo.readState()])).toEqual([
      { version: 3, bots: {} },
      { version: 3, bots: {} },
    ]);
    expect(await readFile(oldPath, "utf8")).toBe(old);
  });
});
