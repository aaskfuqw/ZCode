import { describe, expect, it, vi } from "vitest";
import { BrowserOAuthCredentialRepo } from "../src/auth/browserOAuthCredentialRepo.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function createUnsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}

describe("BrowserOAuthCredentialRepo", () => {
  it("ignores upstream credentials and pending OAuth state without deleting them", () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const upstreamCredentials = {
      "oauth:active_provider": "zai",
      zcodejwttoken: "upstream-jwt",
      "oauth:zai:access_token": "upstream-access-token",
      "oauth:zai:user_info": JSON.stringify({ user_id: "upstream-user", name: "Upstream" }),
      "oauth:bigmodel:access_token": "upstream-bigmodel-token",
      "oauth:bigmodel:user_info": JSON.stringify({ user_id: "123", name: "Upstream" }),
    };
    for (const [key, value] of Object.entries(upstreamCredentials))
      localStorage.setItem(key, value);
    sessionStorage.setItem("oauth_pending_nonce", "upstream-nonce");
    sessionStorage.setItem("oauth_pending_provider", "bigmodel");
    const localReads = vi.spyOn(localStorage, "getItem");
    const sessionReads = vi.spyOn(sessionStorage, "getItem");
    const repo = new BrowserOAuthCredentialRepo({ localStorage, sessionStorage });

    expect(repo.loadCachedSessionState()).toEqual({ status: "signed-out" });
    expect(repo.getActiveProvider()).toBeNull();
    expect(repo.loadZCodeJwtToken()).toBeNull();
    expect(repo.loadPendingNonce()).toBeNull();
    expect(repo.loadPendingProvider()).toBeNull();
    for (const key of Object.keys(upstreamCredentials))
      expect(localReads).not.toHaveBeenCalledWith(key);
    expect(sessionReads).not.toHaveBeenCalledWith("oauth_pending_nonce");
    expect(sessionReads).not.toHaveBeenCalledWith("oauth_pending_provider");

    repo.saveTokenSet({ zcodeJwtToken: "next-jwt", accessToken: "next-token" }, "bigmodel");
    repo.saveUserInfo({ user_id: "456", name: "Next" }, "bigmodel");
    repo.setActiveProvider("bigmodel");
    repo.savePendingNonce("next-nonce");
    repo.savePendingProvider("bigmodel");
    expect(repo.loadCachedSession()?.id).toBe("456");
    repo.clearAll();
    repo.clearPendingNonce();
    repo.clearPendingProvider();

    for (const [key, value] of Object.entries(upstreamCredentials))
      expect(localStorage.getItem(key)).toBe(value);
    expect(sessionStorage.getItem("oauth_pending_nonce")).toBe("upstream-nonce");
    expect(sessionStorage.getItem("oauth_pending_provider")).toBe("bigmodel");
  });

  it("saves and restores a complete ZAI web session", () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const repo = new BrowserOAuthCredentialRepo({ localStorage, sessionStorage });

    repo.saveTokenSet(
      {
        zcodeJwtToken: "jwt-token",
        zaiAccessToken: "zai-token",
      },
      "zai",
    );
    repo.saveUserInfo(
      {
        user_id: "u_1",
        name: "Ada",
        email: "ada@example.com",
        avatar: "https://example.com/a.png",
      },
      "zai",
    );
    repo.setActiveProvider("zai");

    expect(repo.loadCachedSession()).toEqual({
      id: "u_1",
      username: "Ada",
      displayName: "Ada",
      avatarUrl: "https://example.com/a.png",
    });
    expect(localStorage.getItem("zcode-next:zcodejwttoken")).toBe("jwt-token");
    expect(localStorage.getItem("zcode-next:oauth:zai:access_token")).toBe("zai-token");
  });

  it("clears partial ZAI sessions instead of restoring them", () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const repo = new BrowserOAuthCredentialRepo({ localStorage, sessionStorage });

    localStorage.setItem("zcode-next:oauth:active_provider", "zai");
    localStorage.setItem("zcode-next:zcodejwttoken", "jwt-token");
    localStorage.setItem(
      "zcode-next:oauth:zai:user_info",
      JSON.stringify({ user_id: "u_1", name: "Ada" }),
    );

    expect(repo.loadCachedSession()).toBeNull();
    expect(localStorage.getItem("zcode-next:oauth:active_provider")).toBeNull();
    expect(localStorage.getItem("zcode-next:zcodejwttoken")).toBeNull();
    expect(localStorage.getItem("zcode-next:oauth:zai:user_info")).toBeNull();
  });

  // private 分享的 owner 身份是 provider 特定的（bigmodel 是数字 ID，z.ai 是 UUID），
  // 所以 BigModel 登录必须能独立存取，不能被 zai 的 key 段和判定挡掉。
  it("saves and restores a complete BigModel web session", () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const repo = new BrowserOAuthCredentialRepo({ localStorage, sessionStorage });

    repo.saveTokenSet({ zcodeJwtToken: "jwt-token", accessToken: "bigmodel-token" }, "bigmodel");
    repo.saveUserInfo({ user_id: "53291785835589288", name: "Ada" }, "bigmodel");
    repo.setActiveProvider("bigmodel");

    expect(repo.loadCachedSession()).toEqual({
      id: "53291785835589288",
      username: "Ada",
      displayName: "Ada",
    });
    expect(repo.loadZCodeJwtToken()).toBe("jwt-token");
    expect(localStorage.getItem("zcode-next:oauth:bigmodel:access_token")).toBe("bigmodel-token");
    // 不能污染 zai 的 key 段
    expect(localStorage.getItem("zcode-next:oauth:zai:access_token")).toBeNull();
  });

  it("切换 provider 时清掉上一个身份的残片", () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const repo = new BrowserOAuthCredentialRepo({ localStorage, sessionStorage });

    repo.saveTokenSet({ zcodeJwtToken: "jwt-zai", zaiAccessToken: "zai-token" }, "zai");
    repo.saveUserInfo({ user_id: "uuid-1", name: "Ada" }, "zai");
    repo.setActiveProvider("zai");

    repo.clearAll();
    repo.saveTokenSet({ zcodeJwtToken: "jwt-bm", accessToken: "bm-token" }, "bigmodel");
    repo.saveUserInfo({ user_id: "53291785835589288", name: "Ada" }, "bigmodel");
    repo.setActiveProvider("bigmodel");

    expect(localStorage.getItem("zcode-next:oauth:zai:access_token")).toBeNull();
    expect(localStorage.getItem("zcode-next:oauth:zai:user_info")).toBeNull();
    expect(repo.loadCachedSession()?.id).toBe("53291785835589288");
  });

  it("记住并归还本次跳出去登录用的 provider", () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const repo = new BrowserOAuthCredentialRepo({ localStorage, sessionStorage });

    expect(repo.loadPendingProvider()).toBeNull();
    repo.savePendingProvider("bigmodel");
    expect(repo.loadPendingProvider()).toBe("bigmodel");
    // 只进 sessionStorage，不落 localStorage
    expect(localStorage.getItem("zcode-next:oauth_pending_provider")).toBeNull();
    repo.clearPendingProvider();
    expect(repo.loadPendingProvider()).toBeNull();

    sessionStorage.setItem("zcode-next:oauth_pending_provider", "not-a-provider");
    expect(repo.loadPendingProvider()).toBeNull();
  });

  it("clears an expired JWT session and requests reauthentication", () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const repo = new BrowserOAuthCredentialRepo(
      { localStorage, sessionStorage },
      { now: () => 2_000_000 },
    );

    localStorage.setItem("zcode-next:oauth:active_provider", "zai");
    localStorage.setItem("zcode-next:zcodejwttoken", createUnsignedJwt({ exp: 1_000 }));
    localStorage.setItem("zcode-next:oauth:zai:access_token", "zai-token");
    localStorage.setItem(
      "zcode-next:oauth:zai:user_info",
      JSON.stringify({ user_id: "u_1", name: "Ada" }),
    );

    expect(repo.loadCachedSessionState()).toEqual({
      status: "reauthentication-required",
      reason: "jwt-expired",
    });
    expect(localStorage.getItem("zcode-next:oauth:active_provider")).toBeNull();
    expect(localStorage.getItem("zcode-next:zcodejwttoken")).toBeNull();
    expect(localStorage.getItem("zcode-next:oauth:zai:access_token")).toBeNull();
    expect(localStorage.getItem("zcode-next:oauth:zai:user_info")).toBeNull();
  });

  it("stores pending nonce in session storage only", () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const repo = new BrowserOAuthCredentialRepo({ localStorage, sessionStorage });

    repo.savePendingNonce("nonce-1");

    expect(repo.loadPendingNonce()).toBe("nonce-1");
    expect(localStorage.getItem("zcode-next:oauth_pending_nonce")).toBeNull();

    repo.clearPendingNonce();

    expect(repo.loadPendingNonce()).toBeNull();
  });
});
