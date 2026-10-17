import { describe, expect, it } from "vitest";
import { SERVER_REMOTE_PROTOCOL_VERSION, serverRemoteInfoSchema } from "@zcode/shared";
import { CURRENT_PROTOCOL_CONTRACT } from "@zcode/shared/zcode-protocol-v4";

const serverInfo = {
  serverId: "remote-server",
  version: "3.12.0",
  protocolVersion: SERVER_REMOTE_PROTOCOL_VERSION,
  protocolContract: CURRENT_PROTOCOL_CONTRACT,
  authRequired: false,
  workspaces: [],
  capabilities: { desktopContinuous: true, websocketRpc: true },
};

describe("Server business capabilities", () => {
  it("advertises continuous delivery and websocket RPC", () => {
    const parsed = serverRemoteInfoSchema.parse(serverInfo);
    expect(parsed).toEqual(serverInfo);
    expect(parsed.protocolVersion).toBe(SERVER_REMOTE_PROTOCOL_VERSION);
  });

  it.each([
    undefined,
    {
      ...CURRENT_PROTOCOL_CONTRACT,
      protocolVersion: CURRENT_PROTOCOL_CONTRACT.protocolVersion + 1,
    },
    { ...CURRENT_PROTOCOL_CONTRACT, capabilities: {} },
    { ...CURRENT_PROTOCOL_CONTRACT, capabilities: { workflowRunDeltas: false } },
  ])("requires the current paired protocol contract: %j", (protocolContract) => {
    expect(serverRemoteInfoSchema.safeParse({ ...serverInfo, protocolContract }).success).toBe(
      false,
    );
  });
});
