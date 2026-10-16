import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotWindowsPackagedResources } from "../src/main/windowsPackagedResourceSnapshot.js";

describe("windows packaged resource snapshot", () => {
  it("snapshots packaged resource dirs without throwing on missing dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-resource-snapshot-"));
    try {
      const toolsDir = join(root, "tools");
      mkdirSync(toolsDir, { recursive: true });
      writeFileSync(join(toolsDir, "rg"), "binary", "utf8");

      const snapshot = snapshotWindowsPackagedResources(root);

      expect(snapshot.find((entry) => entry.dir === "tools")).toMatchObject({
        path: toolsDir,
        exists: true,
        entries: ["rg"],
      });
      expect(snapshot.find((entry) => entry.dir === "glm")).toMatchObject({
        exists: false,
        entries: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
