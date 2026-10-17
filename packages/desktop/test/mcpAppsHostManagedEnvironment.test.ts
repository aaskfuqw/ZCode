import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_PROTOCOL_CONTRACT,
  ZCodeProtocolContractError,
  helloMessageSchema,
} from "@zcode/shared/zcode-protocol-v4";

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<unknown>>(),
  startAgent: vi.fn(),
  startModel: vi.fn(),
  agent: { call: vi.fn(), close: vi.fn(), client: { onNotification: vi.fn() } },
  model: { env: {}, close: vi.fn() },
}));
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) =>
      fixture.handlers.set(channel, handler),
  },
  webContents: {},
}));
vi.mock("../src/main/pluginSandbox/index.js", () => ({
  installPluginSandboxHost: () => ({}),
}));
vi.mock("../../services/src/plugin-ui-bridge/pluginUiBridgeService.js", () => ({
  createPluginUiBridgeService: () => ({}),
}));
vi.mock("../../services/src/plugin-ui-bridge/pluginUiSamplingService.js", () => ({
  createPluginUiSamplingService: () => ({}),
}));
vi.mock("../scripts/mcp-apps-host-fixture/model.js", () => ({
  startModel: fixture.startModel,
}));
vi.mock("../scripts/mcp-apps-host-fixture/agent.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scripts/mcp-apps-host-fixture/agent.js")>()),
  startAgent: fixture.startAgent,
}));
import { managedEnvironment } from "../scripts/mcp-apps-host-fixture/managed-environment.js";

let environment: Awaited<ReturnType<typeof managedEnvironment>> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.handlers.clear();
  fixture.startAgent.mockResolvedValue(fixture.agent);
  fixture.startModel.mockResolvedValue(fixture.model);
});
afterEach(async () => {
  await environment?.close();
  environment = undefined;
});

const clientHello = {
  kind: "clientHello",
  ...CURRENT_PROTOCOL_CONTRACT,
  clientId: "fixture-client",
  clientKind: "desktop",
  appVersion: "unrelated-build-version",
};
const invoke = (method: string, params?: unknown) =>
  fixture.handlers.get("fixture-v4")!({ sender: { id: 7 } }, method, params);

describe("managed MCP Apps fixture protocol contract", () => {
  it("advertises the current contract and accepts client initialization independently of product version", async () => {
    environment = await managedEnvironment("/fixture", "node", "cli");
    const hello = helloMessageSchema.parse(await invoke("helloConversationV4"));
    expect(hello).toMatchObject({
      protocolVersion: CURRENT_PROTOCOL_CONTRACT.protocolVersion,
      capabilities: CURRENT_PROTOCOL_CONTRACT.capabilities,
      connectionId: "managed-7",
      clientMode: "desktop-continuous",
      deliveryProfile: "continuous",
    });
    await expect(invoke("initializeConversationV4", clientHello)).resolves.toBeUndefined();
    expect(fixture.agent.call).not.toHaveBeenCalled();
  });

  it.each([
    { ...clientHello, protocolVersion: CURRENT_PROTOCOL_CONTRACT.protocolVersion + 1 },
    { ...clientHello, capabilities: {} },
    { ...clientHello, capabilities: { workflowRunDeltas: false } },
  ])("rejects incompatible client initialization: %j", async (hello) => {
    environment = await managedEnvironment("/fixture", "node", "cli");
    await expect(invoke("initializeConversationV4", hello)).rejects.toMatchObject({
      code: "fault.protocol.incompatible",
      message: expect.stringContaining("Update or redeploy"),
    });
    expect(fixture.agent.call).not.toHaveBeenCalled();
  });

  it("closes the fixture model when CLI admission fails", async () => {
    const error = new ZCodeProtocolContractError();
    fixture.startAgent.mockRejectedValue(error);
    await expect(managedEnvironment("/fixture", "node", "cli")).rejects.toBe(error);
    expect(fixture.model.close).toHaveBeenCalledOnce();
    expect(fixture.handlers.size).toBe(0);
  });
});
