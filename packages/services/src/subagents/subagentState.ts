import { readFile } from "node:fs/promises";
import {
  subagentStateFileSchema,
  InvalidSubagentStateError,
  type SubagentStateFile,
} from "@zcode/shared";

export { InvalidSubagentStateError } from "@zcode/shared";
export type AgentsStateFile = SubagentStateFile;

export async function readSubagentState(path: string): Promise<AgentsStateFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return subagentStateFileSchema.parse({});
    throw error;
  }
  try {
    return subagentStateFileSchema.parse(JSON.parse(raw));
  } catch (cause) {
    throw new InvalidSubagentStateError(path, cause);
  }
}
