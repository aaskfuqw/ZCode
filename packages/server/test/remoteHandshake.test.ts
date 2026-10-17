import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { Emitter } from "@zcode/rpc";
import { ZCODE_VERSION } from "@zcode/shared";
import {
  CURRENT_PROTOCOL_CONTRACT,
  ZCodeProtocolContractError,
} from "@zcode/shared/zcode-protocol-v4";
import { performHandshake } from "../src/remote/handshake.js";

function createStream() {
  const close = new Emitter<number>();
  return {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    onClose: close.event,
  };
}

const hello = {
  type: "zcode-hello",
  version: "different-product-version",
  platform: "linux",
  arch: "arm64",
  pid: 123,
  protocolContract: CURRENT_PROTOCOL_CONTRACT,
};

describe("remote Server stdio handshake", () => {
  it("skips SSH banners and preserves remaining RPC data while admitting the paired contract", async () => {
    const stream = createStream();
    const handshake = performHandshake(stream, "desktop");
    stream.stdout.write(
      `SSH welcome\n{not JSON}\n${JSON.stringify({ type: "motd" })}\n${JSON.stringify(hello)}\nrpc-data`,
    );
    const result = await handshake;
    expect(result.hello).toEqual(hello);
    expect(result.remaining?.toString()).toBe("rpc-data");
    expect(JSON.parse(stream.stdin.read().toString())).toEqual({
      type: "zcode-hello-ack",
      version: ZCODE_VERSION,
      clientId: "desktop",
      protocolContract: CURRENT_PROTOCOL_CONTRACT,
    });
    expect(stream.stdout.listenerCount("data")).toBe(0);
    expect(stream.stderr.listenerCount("data")).toBe(0);
  });

  it("waits for a complete hello before acknowledging", async () => {
    const stream = createStream();
    const handshake = performHandshake(stream, "desktop");
    const line = JSON.stringify(hello);
    stream.stdout.write(line.slice(0, -1));
    expect(stream.stdin.readableLength).toBe(0);
    stream.stdout.write(line.slice(-1) + "\n");
    await expect(handshake).resolves.toMatchObject({ hello, remaining: null });
    expect(stream.stdin.readableLength).toBeGreaterThan(0);
  });

  it.each([
    undefined,
    {
      ...CURRENT_PROTOCOL_CONTRACT,
      protocolVersion: CURRENT_PROTOCOL_CONTRACT.protocolVersion + 1,
    },
    { ...CURRENT_PROTOCOL_CONTRACT, capabilities: {} },
    { ...CURRENT_PROTOCOL_CONTRACT, capabilities: { workflowRunDeltas: false } },
  ])(
    "rejects an incompatible Server immediately without sending an ack: %j",
    async (protocolContract) => {
      const stream = createStream();
      const handshake = performHandshake(stream, "desktop");
      stream.stdout.write(JSON.stringify({ ...hello, protocolContract }) + "\n");
      await expect(handshake).rejects.toBeInstanceOf(ZCodeProtocolContractError);
      await expect(handshake).rejects.toMatchObject({
        code: "fault.protocol.incompatible",
        message: expect.stringContaining("Update or redeploy the paired Next components"),
      });
      expect(stream.stdin.readableLength).toBe(0);
      expect(stream.stdout.listenerCount("data")).toBe(0);
      expect(stream.stderr.listenerCount("data")).toBe(0);
    },
  );
});
