import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import {
  botsConfigFileSchema,
  botsStateFileSchema,
  type BotsConfigFile,
  type BotsStateFile,
} from "@zcode/shared";
import { getAppConfigDir } from "../paths.js";
import { BOTS_CONFIG_FILE, BOTS_STATE_FILE, createDefaultBotsConfig } from "./config.js";

function incompatibleBotData(path: string, cause: unknown): Error {
  return new Error(
    `Incompatible Next bot data: ${path}. Close Next, back up and move only this file, ` +
      "then restart to create current bot data. Keep project and workspace files.",
    { cause },
  );
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw incompatibleBotData(path, error);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await atomicWritePrivateTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export class BotsRepo {
  async readConfig(): Promise<BotsConfigFile> {
    const path = join(getAppConfigDir(), BOTS_CONFIG_FILE);
    return withFileLock(path, async () => {
      const current = await readOptionalJson(path);
      if (current !== undefined) {
        const parsed = botsConfigFileSchema.safeParse(current);
        if (!parsed.success) throw incompatibleBotData(path, parsed.error);
        return parsed.data;
      }
      const config = createDefaultBotsConfig();
      await writeJson(path, config);
      return config;
    });
  }

  async writeConfig(config: BotsConfigFile): Promise<BotsConfigFile> {
    const parsed = botsConfigFileSchema.parse(config);
    const path = join(getAppConfigDir(), BOTS_CONFIG_FILE);
    await withFileLock(path, () => writeJson(path, parsed));
    return parsed;
  }

  async readState(): Promise<BotsStateFile> {
    const path = join(getAppConfigDir(), BOTS_STATE_FILE);
    return withFileLock(path, async () => {
      const current = await readOptionalJson(path);
      if (current !== undefined) {
        const parsed = botsStateFileSchema.safeParse(current);
        if (!parsed.success) throw incompatibleBotData(path, parsed.error);
        return parsed.data;
      }
      const state: BotsStateFile = { version: 3, bots: {} };
      await writeJson(path, state);
      return state;
    });
  }

  async writeState(state: BotsStateFile): Promise<BotsStateFile> {
    const parsed = botsStateFileSchema.parse(state);
    const path = join(getAppConfigDir(), BOTS_STATE_FILE);
    await withFileLock(path, () => writeJson(path, parsed));
    return parsed;
  }
}
