import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFinderOpenFolderWorkflow } from "../src/main/desktopFinderOpenFolderWorkflow.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("desktopFinderOpenFolderWorkflow", () => {
  it("installs a Next service without changing the upstream workflow", () => {
    const homeDir = createTempHome();
    const servicesDir = join(homeDir, "Library", "Services");
    const upstreamPath = join(servicesDir, "Open in ZCode.workflow");
    mkdirSync(servicesDir, { recursive: true });
    writeFileSync(upstreamPath, "upstream-workflow");
    installFinderOpenFolderWorkflow({
      platform: "darwin",
      locale: "en-US",
      homeDir,
      logger: { info: vi.fn(), warn: vi.fn() },
      refreshServicesIndex: vi.fn(),
    });
    expect(readFileSync(upstreamPath, "utf8")).toBe("upstream-workflow");
    expect(readInfoPlist(homeDir)).toContain("dev.zcode.next.finder-open-workflow");
    const workflow = readFileSync(
      join(servicesDir, "Open in ZCode Next.workflow", "Contents", "document.wflow"),
      "utf8",
    );
    expect(workflow).toContain("zcode-next://workspace/open");
    expect(workflow).not.toContain("zcode://");
  });

  it("按中文 locale 写入 Finder 服务展示名", () => {
    const homeDir = createTempHome();
    const refreshServicesIndex = vi.fn();

    installFinderOpenFolderWorkflow({
      platform: "darwin",
      locale: "zh-CN",
      homeDir,
      logger: { info: vi.fn(), warn: vi.fn() },
      refreshServicesIndex,
    });

    const infoPlist = readInfoPlist(homeDir);
    expect(infoPlist).toContain("<string>在ZCode Next中打开</string>");
    expect(infoPlist).not.toContain("<string>Open in ZCode Next</string>");
    expect(refreshServicesIndex).toHaveBeenCalledTimes(1);
  });

  it("按英文 locale 写入 Finder 服务展示名并复用稳定 workflow 文件名", () => {
    const homeDir = createTempHome();
    const refreshServicesIndex = vi.fn();

    installFinderOpenFolderWorkflow({
      platform: "darwin",
      locale: "en-US",
      homeDir,
      logger: { info: vi.fn(), warn: vi.fn() },
      refreshServicesIndex,
    });

    const infoPlist = readInfoPlist(homeDir);
    expect(infoPlist).toContain("<string>Open in ZCode Next</string>");
    expect(infoPlist).not.toContain("<string>在ZCode Next中打开</string>");
    expect(infoPlist).toContain("<string>5</string>");
    expect(refreshServicesIndex).toHaveBeenCalledTimes(1);
  });

  it("非 macOS 不安装 Finder 服务", () => {
    const homeDir = createTempHome();
    const refreshServicesIndex = vi.fn();

    installFinderOpenFolderWorkflow({
      platform: "linux",
      locale: "zh-CN",
      homeDir,
      logger: { info: vi.fn(), warn: vi.fn() },
      refreshServicesIndex,
    });

    expect(refreshServicesIndex).not.toHaveBeenCalled();
  });
});

function createTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "zcode-finder-workflow-"));
  tempDirs.push(dir);
  return dir;
}

function readInfoPlist(homeDir: string): string {
  return readFileSync(
    join(homeDir, "Library", "Services", "Open in ZCode Next.workflow", "Contents", "Info.plist"),
    "utf8",
  );
}
