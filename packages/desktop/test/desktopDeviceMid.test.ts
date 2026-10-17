import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDesktopDeviceMid } from "../src/main/desktopDeviceMid.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function createDirectory() {
  const path = await mkdtemp(join(tmpdir(), "zcode-desktop-device-"));
  directories.push(path);
  return path;
}

describe("Desktop business device identity", () => {
  it("reuses the existing identity and leaves legacy user files intact", async () => {
    const configDir = await createDirectory();
    const legacy = JSON.stringify({ deviceMid: "existing-mid", queue: ["old-event"] });
    await writeFile(join(configDir, "telemetry-state.json"), legacy);
    expect(await ensureDesktopDeviceMid({ configDir })).toBe("existing-mid");
    expect(await readFile(join(configDir, "telemetry-state.json"), "utf8")).toBe(legacy);
    expect(JSON.parse(await readFile(join(configDir, "device-identity.json"), "utf8"))).toEqual({
      deviceMid: "existing-mid",
    });
  });

  it("allows startup to continue when identity storage is unavailable", async () => {
    const directory = await createDirectory();
    const file = join(directory, "file");
    await writeFile(file, "occupied");
    expect(
      await ensureDesktopDeviceMid({
        configDir: join(file, "nested"),
        createId: () => "fallback-mid",
      }),
    ).toBe("fallback-mid");
  });
});
