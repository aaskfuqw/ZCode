import { describe, expect, it } from "vitest";
import {
  helloMessageSchema,
  helloAckMessageSchema,
  remoteHelloMessageSchema,
  remoteHelloAckMessageSchema,
} from "@zcode/shared";
import { CURRENT_PROTOCOL_CONTRACT } from "@zcode/shared/zcode-protocol-v4";

describe("remote hello contract authority", () => {
  it("keeps general hello schema names as aliases of the paired remote contract", () => {
    expect(helloMessageSchema).toBe(remoteHelloMessageSchema);
    expect(helloAckMessageSchema).toBe(remoteHelloAckMessageSchema);
  });

  it.each([undefined, {}, { ...CURRENT_PROTOCOL_CONTRACT, capabilities: {} }])(
    "rejects an old general hello and ack through the current typed boundary: %j",
    (protocolContract) => {
      expect(
        helloMessageSchema.safeParse({
          type: "zcode-hello",
          version: "1.0",
          platform: "linux",
          arch: "x64",
          pid: 1,
          protocolContract,
        }).success,
      ).toBe(false);
      expect(
        helloAckMessageSchema.safeParse({
          type: "zcode-hello-ack",
          version: "2.0",
          clientId: "desktop",
          protocolContract,
        }).success,
      ).toBe(false);
    },
  );
});
