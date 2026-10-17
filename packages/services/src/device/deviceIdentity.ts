import { join } from "node:path";
import { ensureBusinessDeviceMid } from "@zcode/shared/node";
import { getAppConfigDir } from "../paths.js";

export function ensureDeviceMid(
  options: { homeDir?: string; randomUUID?: () => string } = {},
): Promise<string> {
  return ensureBusinessDeviceMid(
    options.homeDir ? join(options.homeDir, ".zcode", "v2") : getAppConfigDir(),
    options.randomUUID,
  );
}
