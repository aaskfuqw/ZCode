import { describe, expect, it } from "vitest";
import { SERVER_REMOTE_PROTOCOL_VERSION, serverRemoteInfoSchema } from "@zcode/shared";

const serverInfo = {
  serverId: "remote-server",
  version: "3.12.0",
  protocolVersion: SERVER_REMOTE_PROTOCOL_VERSION,
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
});
