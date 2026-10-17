import { describe, expect, it, vi } from "vitest";

describe("oauth callback bridge", () => {
  it("delivers the URL to the asynchronous renderer callback", async () => {
    const { createOAuthCallbackHandler } = await import("../src/preload/oauthCallbackBridge.js");
    const callback = vi.fn(async (_url: string) => {});
    const handler = createOAuthCallbackHandler(callback);

    await handler({}, "zcode://oauth/callback?code=123");

    expect(callback).toHaveBeenCalledWith("zcode://oauth/callback?code=123");
  });

  it("isolates a rejected renderer callback", async () => {
    const { createOAuthCallbackHandler } = await import("../src/preload/oauthCallbackBridge.js");
    const callback = vi.fn(async () => {
      throw new Error("callback failed");
    });
    const handler = createOAuthCallbackHandler(callback);

    await expect(handler({}, "zcode://oauth/callback?code=123")).resolves.toBeUndefined();
  });
});
