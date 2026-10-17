import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureBusinessDeviceMid } from "../src/node/deviceIdentity.js";

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "zcode-device-identity-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("business device identity", () => {
  it("migrates only the existing identity and preserves legacy user files", async () => {
    const directory = await fixture();
    const legacy = {
      deviceMid: "existing-device",
      lastDailyActiveDate: "2026-01-01",
      pending: ["fixture"],
    };
    await writeFile(join(directory, "telemetry-state.json"), JSON.stringify(legacy));
    const createId = vi.fn(() => "unexpected-new-device");
    expect(await ensureBusinessDeviceMid(directory, createId)).toBe("existing-device");
    expect(createId).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(directory, "device-identity.json"), "utf8"))).toEqual({
      deviceMid: "existing-device",
    });
    expect(JSON.parse(await readFile(join(directory, "telemetry-state.json"), "utf8"))).toEqual(
      legacy,
    );
  });

  it("prefers independent identity storage and shares concurrent initialization", async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, "device-identity.json"),
      JSON.stringify({ deviceMid: "business-device" }),
    );
    await writeFile(
      join(directory, "telemetry-state.json"),
      JSON.stringify({ deviceMid: "old-device" }),
    );
    expect(await ensureBusinessDeviceMid(directory)).toBe("business-device");
    const fresh = await fixture();
    const createId = vi.fn(() => "one-device");
    expect(
      await Promise.all(Array.from({ length: 8 }, () => ensureBusinessDeviceMid(fresh, createId))),
    ).toEqual(Array(8).fill("one-device"));
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("allows a retry after a storage failure", async () => {
    const directory = await fixture();
    const blocked = join(directory, "blocked");
    await writeFile(blocked, "not a directory");
    await expect(ensureBusinessDeviceMid(blocked)).rejects.toThrow();
    await rm(blocked);
    await mkdir(blocked);
    expect(await ensureBusinessDeviceMid(blocked, () => "recovered-device")).toBe(
      "recovered-device",
    );
  });
});
