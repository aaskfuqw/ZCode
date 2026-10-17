import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  directory: "",
  listeners: new Map<string, (...args: any[]) => void>(),
  crashReporterStart: vi.fn(),
  setPath: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("electron", () => ({
  app: {
    name: "ZCode",
    setPath: h.setPath,
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      h.listeners.set(event, listener);
    }),
  },
  crashReporter: { start: h.crashReporterStart },
}));
vi.mock("@zcode/services/node", () => ({ getAppConfigDir: () => h.directory }));
vi.mock("../src/main/logger.js", () => ({ logger: h.logger }));

afterEach(async () => {
  vi.useRealTimers();
  if (h.directory) await rm(h.directory, { recursive: true, force: true });
});

it("starts local crash capture and archives a settled dump after a renderer crash", async () => {
  vi.useFakeTimers();
  h.directory = await mkdtemp(join(tmpdir(), "zcode-local-crash-bootstrap-"));
  await import("../src/main/appCrashCaptureBootstrap.js");

  expect(h.crashReporterStart).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ uploadToServer: false }),
  );
  expect(h.setPath).toHaveBeenCalledWith("crashDumps", join(h.directory, "crash", "live"));
  expect([...h.listeners.keys()]).toEqual([
    "render-process-gone",
    "child-process-gone",
    "browser-window-created",
  ]);

  const sourceDirectory = join(
    h.directory,
    "crash",
    "live",
    process.platform === "win32" ? "reports" : "completed",
  );
  await mkdir(sourceDirectory, { recursive: true });
  const dumpPath = join(sourceDirectory, "renderer.dmp");
  await writeFile(dumpPath, "local-crash-fixture");
  const settled = new Date(Date.now() - 5_000);
  await utimes(dumpPath, settled, settled);
  h.listeners.get("render-process-gone")!(
    {},
    { id: 19, getType: () => "window", getURL: () => "about:blank" },
    { reason: "crashed", exitCode: 1 },
  );
  expect(h.logger.warn).toHaveBeenCalledWith(
    "[crash-capture] render-process-gone:",
    expect.objectContaining({ reason: "crashed", exitCode: 1 }),
  );
  vi.advanceTimersByTime(1_500);
  expect(await readFile(join(h.directory, "crash", "archive", "renderer.dmp"), "utf8")).toBe(
    "local-crash-fixture",
  );
});
