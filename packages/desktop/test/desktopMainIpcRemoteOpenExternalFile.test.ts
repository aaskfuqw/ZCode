import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformChannels } from "@zcode/shared";

type IpcHandler = (...args: unknown[]) => unknown;
type RemoteIpcOptions = Parameters<
  typeof import("../src/main/desktopMainIpcRemote.js").registerRemoteIpcHandlers
>[0];

const h = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  listeners: new Map<string, IpcHandler>(),
  fromWebContents: vi.fn(),
  registerWebRemoteControlIpcHandlers: vi.fn(),
  shellOpenExternal: vi.fn(),
  shellOpenPath: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    on: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: h.fromWebContents,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => h.handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => h.listeners.set(channel, handler)),
  },
  shell: {
    openExternal: h.shellOpenExternal,
    openPath: h.shellOpenPath,
  },
}));

vi.mock("../src/main/desktopNotifications.js", () => ({
  dispatchTaskNotification: vi.fn(),
}));

vi.mock("../src/main/desktopOAuthDeepLink.js", () => ({
  clearOAuthRoutesForWindow: vi.fn(),
  deliverPendingDeepLink: vi.fn(() => false),
  parseOAuthStateRegistration: vi.fn(),
  registerOAuthState: vi.fn(),
}));

vi.mock("../src/main/desktopWebRemoteControlIpc.js", () => ({
  registerWebRemoteControlIpcHandlers: h.registerWebRemoteControlIpcHandlers,
}));

function createOptions(): RemoteIpcOptions {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    webRemoteControlManager: {
      authorizeStart: vi.fn(),
      startAuthorized: vi.fn(),
      resetPairingAuthorized: vi.fn(),
      stop: vi.fn(),
      getStatus: vi.fn(),
    },
    createRemoteWorkspaceSession: vi.fn(async () => "remote-session-1"),
    disposeRemoteWorkspaceSession: vi.fn(),
    cancelPendingRemoteWorkspaceSessionsForWindow: vi.fn(),
    bindRemoteWorkspaceSessionContext: vi.fn(),
    confirmRendererAttachmentReady: vi.fn(),
    isDockerDaemonAvailable: vi.fn(async () => true),
    listAvailableWSLDistros: vi.fn(async () => []),
    listAvailableDockerContainers: vi.fn(async () => []),
    listSSHConfigAliases: vi.fn(async () => []),
  };
}

async function registerOpenExternalListener() {
  const { registerRemoteIpcHandlers } = await import("../src/main/desktopMainIpcRemote.js");
  const options = createOptions();
  registerRemoteIpcHandlers(options);
  const listener = h.listeners.get(PlatformChannels.OpenExternal);
  expect(listener).toBeDefined();
  return { listener: listener!, options };
}

describe("OpenExternal 对 file URL 的分流", () => {
  beforeEach(() => {
    h.handlers.clear();
    h.listeners.clear();
    h.fromWebContents.mockReset();
    h.shellOpenExternal.mockReset().mockResolvedValue(undefined);
    h.shellOpenPath.mockReset().mockResolvedValue("");
  });

  it("中文与空格的 file URL 走 shell.openPath 且收到解码后的本地路径", async () => {
    const { listener } = await registerOpenExternalListener();
    const sender = { getURL: vi.fn(() => "about:blank") };

    listener({ sender }, "file:///E:/04%20%E7%B4%A0%E6%9D%90/page.html");

    await vi.waitFor(() => expect(h.shellOpenPath).toHaveBeenCalledTimes(1));
    expect(h.shellOpenPath).toHaveBeenCalledWith(expect.stringContaining("04 素材"));
    expect(h.shellOpenPath).toHaveBeenCalledWith(expect.stringContaining("page.html"));
    expect(h.shellOpenPath).not.toHaveBeenCalledWith(expect.stringContaining("%"));
    expect(h.shellOpenExternal).not.toHaveBeenCalled();
  });

  it("带锚点的 file URL 剥掉 hash 后仍走 shell.openPath", async () => {
    const { listener } = await registerOpenExternalListener();
    const sender = { getURL: vi.fn(() => "about:blank") };

    listener({ sender }, "file:///tmp/report.html#section");

    await vi.waitFor(() => expect(h.shellOpenPath).toHaveBeenCalledTimes(1));
    expect(h.shellOpenPath).not.toHaveBeenCalledWith(expect.stringContaining("#"));
    expect(h.shellOpenExternal).not.toHaveBeenCalled();
  });

  it("http URL 仍走 shell.openExternal", async () => {
    const { listener } = await registerOpenExternalListener();
    const sender = { getURL: vi.fn(() => "about:blank") };

    listener({ sender }, "https://example.com/docs");

    await vi.waitFor(() => expect(h.shellOpenExternal).toHaveBeenCalledTimes(1));
    expect(h.shellOpenExternal).toHaveBeenCalledWith("https://example.com/docs");
    expect(h.shellOpenPath).not.toHaveBeenCalled();
  });

  it("file URL 无法转换为本地路径时记录 warn 且不回退到 shell.openExternal", async () => {
    const { listener, options } = await registerOpenExternalListener();
    const sender = { getURL: vi.fn(() => "about:blank") };

    listener({ sender }, "file://server/share/page.html");

    await vi.waitFor(() => expect(options.logger.warn).toHaveBeenCalledTimes(1));
    expect(h.shellOpenPath).not.toHaveBeenCalled();
    expect(h.shellOpenExternal).not.toHaveBeenCalled();
  });
});

describe("ConnectRemote business admission", () => {
  beforeEach(() => {
    h.handlers.clear();
    h.listeners.clear();
    h.fromWebContents.mockReset();
  });

  async function registerConnectHandler() {
    const { registerRemoteIpcHandlers } = await import("../src/main/desktopMainIpcRemote.js");
    const options = createOptions();
    registerRemoteIpcHandlers(options);
    const handler = h.handlers.get(PlatformChannels.ConnectRemote);
    expect(handler).toBeDefined();
    return { handler: handler!, options };
  }

  it("passes the window, request correlation and remote workspace identity to the owner", async () => {
    const { handler, options } = await registerConnectHandler();
    const sender = { id: 17 };
    const win = { webContents: sender };
    h.fromWebContents.mockReturnValue(win);
    const target = { kind: "ssh", host: "example.com", username: "developer" };
    await expect(
      handler(
        { sender },
        {
          target,
          requestId: " request-1 ",
          workspacePath: "/workspace/project",
          workspaceIdentity: "ssh:project",
        },
      ),
    ).resolves.toEqual({ success: true, sessionId: "remote-session-1" });
    expect(h.fromWebContents).toHaveBeenCalledWith(sender);
    expect(options.createRemoteWorkspaceSession).toHaveBeenCalledExactlyOnceWith(
      win,
      target,
      "request-1",
      { workspacePath: "/workspace/project", workspaceIdentity: "ssh:project" },
    );
  });

  it("accepts a target without workspace context", async () => {
    const { handler, options } = await registerConnectHandler();
    const win = { webContents: { id: 18 } };
    h.fromWebContents.mockReturnValue(win);
    const target = { kind: "docker", container: "dev-container" };
    await expect(handler({ sender: win.webContents }, target)).resolves.toEqual({
      success: true,
      sessionId: "remote-session-1",
    });
    expect(options.createRemoteWorkspaceSession).toHaveBeenCalledExactlyOnceWith(
      win,
      target,
      undefined,
      undefined,
    );
  });

  it("rejects invalid targets before creating a connection", async () => {
    const { handler, options } = await registerConnectHandler();
    await expect(handler({ sender: { id: 17 } }, { target: { kind: "ssh" } })).resolves.toEqual({
      success: false,
      error: expect.stringContaining("Invalid connect-remote payload"),
    });
    expect(options.createRemoteWorkspaceSession).not.toHaveBeenCalled();
  });

  it("returns connection failures to the renderer", async () => {
    const { handler, options } = await registerConnectHandler();
    h.fromWebContents.mockReturnValue({ webContents: { id: 17 } });
    vi.mocked(options.createRemoteWorkspaceSession).mockRejectedValueOnce(
      new Error("Connection cancelled"),
    );
    await expect(handler({ sender: { id: 17 } }, { kind: "wsl" })).resolves.toEqual({
      success: false,
      error: "Connection cancelled",
    });
    expect(options.logger.error).toHaveBeenCalledOnce();
  });
});
