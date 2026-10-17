import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "./privateFilePersistence.js";

const DEVICE_IDENTITY_FILE = "device-identity.json";
const LEGACY_IDENTITY_FILE = "telemetry-state.json";
const pendingByFile = new Map<string, Promise<string>>();

async function readDeviceMid(file: string): Promise<string | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf-8"));
    if (typeof value !== "object" || value === null || !("deviceMid" in value)) return undefined;
    return typeof value.deviceMid === "string" && value.deviceMid.trim()
      ? value.deviceMid
      : undefined;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** One asynchronous owner shared by Desktop, remote Server, and standalone CLI. */
export function ensureBusinessDeviceMid(
  configDir: string,
  createId: () => string = randomUUID,
): Promise<string> {
  const file = join(configDir, DEVICE_IDENTITY_FILE);
  const cached = pendingByFile.get(file);
  if (cached) return cached;
  const pending = (async () => {
    const existing = await readDeviceMid(file);
    if (existing) return existing;
    return withFileLock(file, async () => {
      const lockedExisting = await readDeviceMid(file);
      if (lockedExisting) return lockedExisting;
      // Only the business identity is migrated; legacy reporting state is never copied or removed.
      const deviceMid = (await readDeviceMid(join(configDir, LEGACY_IDENTITY_FILE))) ?? createId();
      await atomicWritePrivateTextFile(file, JSON.stringify({ deviceMid }, null, 2));
      return deviceMid;
    });
  })().catch((error) => {
    if (pendingByFile.get(file) === pending) pendingByFile.delete(file);
    throw error;
  });
  pendingByFile.set(file, pending);
  return pending;
}
