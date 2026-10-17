// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const { executeDesktopCommand } = vi.hoisted(() => ({
  executeDesktopCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({ executeDesktopCommand }),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: { formatMessage: ({ id }: { id: string }) => id },
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("登录页保留覆盖层窗控", async () => {
  const read = (file: string) => readFile(resolve(__dirname, "../src", file), "utf8");
  expect(await read("WelcomeScreen.tsx")).toContain("<DesktopOverlayWindowControls />");
});

it("登录页原生拖拽层避开窗控，并先于 no-drag 按钮声明", async () => {
  const source = await readFile(resolve(__dirname, "../src/WelcomeScreen.tsx"), "utf8");
  const drag = source.indexOf("[app-region:drag]");
  expect(drag).toBeGreaterThan(-1);
  expect(drag).toBeLessThan(source.indexOf("<DesktopOverlayWindowControls />"));
  expect(source).toContain("platform-windows-desktop:right-[134px]");
  expect(source).toContain("platform-linux-desktop:right-[134px]");
});
