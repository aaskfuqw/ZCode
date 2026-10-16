import { describe, expect, it } from "vitest";
import { delimiter, dirname } from "node:path";

import { withPinnedNodePath } from "../../../scripts/mise-toolchain-env.mjs";

describe("mise toolchain child environment", () => {
  it("puts the launcher Node directory first without duplicating it", () => {
    const nodeDirectory = dirname(process.execPath);
    // 夹具里的固定目录可能与 nodeDirectory 重叠（例如 Node 由系统 /usr/bin 提供，
    // mise 管理的 runtime 也一样）：原断言写死去重后仍有 3 项，重叠时必然失败。
    // 这里按实现的真实契约推导预期：启动器目录置首，其余条目保序且不再重复。
    const firstDirectory = "/opt/homebrew/bin";
    const secondDirectory = "/usr/bin";
    const originalPath = [firstDirectory, nodeDirectory, secondDirectory, nodeDirectory].join(
      delimiter,
    );

    const result = withPinnedNodePath({ PATH: originalPath, KEEP_ME: "yes" }, process.execPath);

    expect(result.PATH?.split(delimiter)).toEqual([
      nodeDirectory,
      ...[firstDirectory, secondDirectory].filter((directory) => directory !== nodeDirectory),
    ]);
    expect(result.KEEP_ME).toBe("yes");
    expect(originalPath).toBe(
      [firstDirectory, nodeDirectory, secondDirectory, nodeDirectory].join(delimiter),
    );
  });

  it("preserves Windows Path casing so pnpm.cmd remains discoverable", () => {
    const nodeDirectory = dirname(process.execPath);
    const originalPath = ["C:/tools/pnpm", nodeDirectory, "C:/Windows/System32"].join(delimiter);

    const result = withPinnedNodePath({ Path: originalPath, KEEP_ME: "yes" }, process.execPath);

    // 修复原因：Windows 盘符包含 `:`，用 macOS/Linux 宿主分隔符拆分会先破坏模拟的 Windows 路径。
    expect(result.Path).toBe(
      [nodeDirectory, "C:/tools/pnpm", "C:/Windows/System32"].join(delimiter),
    );
    expect(result.PATH).toBeUndefined();
  });
});
