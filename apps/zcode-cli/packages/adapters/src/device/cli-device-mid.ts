import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createUuid } from "@zcode/shared";
import { ensureBusinessDeviceMid } from "@zcode/shared/node";

export interface EnsureCliDeviceMidOptions {
  baseDir?: string;
  createId?: () => string;
  env?: Record<string, string | undefined>;
}

const pendingByDirectory = new Map<string, Promise<string>>();

/** Preserve one identity per data directory, including a stable in-process storage-failure fallback. */
export function ensureCliDeviceMid(options: EnsureCliDeviceMidOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const base = options.baseDir ?? env.ZCODE_DATA_BASE_DIR?.trim() ?? homedir();
  const expanded =
    base === "~" ? homedir() : base.startsWith("~/") ? join(homedir(), base.slice(2)) : base;
  const directory = join(resolve(expanded || homedir()), ".zcode", "v2");
  let pending = pendingByDirectory.get(directory);
  if (!pending) {
    const createId = options.createId ?? createUuid;
    pending = ensureBusinessDeviceMid(directory, createId).catch(() => createId());
    pendingByDirectory.set(directory, pending);
  }
  return pending;
}
