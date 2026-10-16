import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WINDOWS_PACKAGED_RESOURCE_DIRS = ["glm", "tools"];

interface WindowsPackagedResourceSnapshotEntry {
  dir: string;
  path: string;
  exists: boolean;
  entries: string[];
}

function listResourceEntries(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .slice(0, 20)
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
  } catch {
    return [];
  }
}

/**
 * 启动诊断用：快照随包资源目录的存在性与前若干条目，用于定位打包缺失。
 */
export function snapshotWindowsPackagedResources(
  resourcesPath: string,
): WindowsPackagedResourceSnapshotEntry[] {
  return WINDOWS_PACKAGED_RESOURCE_DIRS.map((dir) => {
    const path = join(resourcesPath, dir);
    const exists = existsSync(path);
    return {
      dir,
      path,
      exists,
      entries: exists ? listResourceEntries(path) : [],
    };
  });
}
