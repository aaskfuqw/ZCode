import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePrimaryRemoteCdnBaseUrl, resolveRemoteCdnBaseUrls } from "../src/main/remoteCdn.js";

afterEach(() => vi.unstubAllGlobals());

describe("remoteCdn", () => {
  it.each(["production", "test"] as const)("%s has no implicit upstream resource source", (env) => {
    for (const locale of ["zh-CN", "en-US"]) {
      expect(resolveRemoteCdnBaseUrls({ env, locale, timeZone: "Asia/Shanghai" })).toEqual([]);
    }
    expect(resolvePrimaryRemoteCdnBaseUrl({ env })).toBeUndefined();
  });

  it.each(["production", "test"] as const)(
    "%s preserves the configured release-root order",
    (env) => {
      vi.stubGlobal("__ZCODE_REMOTE_CDN_RELEASE_ROOTS__", [
        " https://next-cdn.example.com/releases/// ",
        "https://next-fallback.example.com/releases",
        " ",
      ]);
      expect(resolveRemoteCdnBaseUrls({ env, version: "0.0.0-test", locale: "zh-CN" })).toEqual([
        "https://next-cdn.example.com/releases/0.0.0-test",
        "https://next-fallback.example.com/releases/0.0.0-test",
      ]);
    },
  );

  it("an explicit base URL takes precedence over build roots without appending a version", () => {
    vi.stubGlobal("__ZCODE_REMOTE_CDN_RELEASE_ROOTS__", ["https://next-cdn.example.com/releases"]);
    expect(
      resolveRemoteCdnBaseUrls({
        env: "test",
        overrideBaseUrl: " https://custom.example.com/releases/// ",
        version: "0.0.0-test",
      }),
    ).toEqual(["https://custom.example.com/releases"]);
  });

  it("empty build roots do not restore an upstream fallback", () => {
    vi.stubGlobal("__ZCODE_REMOTE_CDN_RELEASE_ROOTS__", [" ", ""]);
    expect(resolveRemoteCdnBaseUrls()).toEqual([]);
  });
});
