import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { zcodeProtocolNotifications } from "@zcode/shared";
import {
  CURRENT_PROTOCOL_CONTRACT,
  V4_METHODS,
  ZCodeProtocolContractError,
} from "@zcode/shared/zcode-protocol-v4";
import { Events, startAgent } from "../scripts/mcp-apps-host-fixture/agent.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function startPeer() {
  const root = await mkdtemp(join(tmpdir(), "zcode-fixture-admission-"));
  const cli = join(root, "peer.mjs");
  await writeFile(
    cli,
    `import { connect } from "node:net";
const socket = connect(Number(process.env.FIXTURE_PEER_PORT), "127.0.0.1");
process.stdin.pipe(socket);
socket.pipe(process.stdout);
socket.on("end", () => process.stdin.destroy());
`,
  );
  const requests = new Events<{ id: number; method: string; params: unknown }>();
  let peer: Socket | undefined;
  let closed = false;
  const server = createServer((socket) => {
    peer = socket;
    socket.once("close", () => {
      closed = true;
    });
    createInterface({ input: socket }).on("line", (line) => requests.emit(JSON.parse(line)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let settled = false;
  const starting = startAgent(root, process.execPath, cli, {
    FIXTURE_PEER_PORT: String((server.address() as { port: number }).port),
  }).then(
    (agent) => {
      settled = true;
      return { agent, error: undefined };
    },
    (error: unknown) => {
      settled = true;
      return { agent: undefined, error };
    },
  );
  cleanups.push(async () => {
    peer?.end();
    const result = await starting;
    await result.agent?.close();
    peer?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return {
    starting,
    requests,
    isSettled: () => settled,
    isClosed: () => closed,
    send: (message: unknown) => peer!.write(`${JSON.stringify(message)}\n`),
  };
}

describe("MCP Apps fixture CLI admission", () => {
  it("waits for admission before exposing the Agent and initializes once for multiple calls", async () => {
    const peer = await startPeer();
    const initialize = await peer.requests.wait(() => true);
    expect(initialize.method).toBe(V4_METHODS.connectionInitialize);
    expect(initialize.params).toEqual(CURRENT_PROTOCOL_CONTRACT);
    expect(peer.isSettled()).toBe(false);
    expect(peer.requests.history).toHaveLength(1);

    peer.send({ id: initialize.id, result: CURRENT_PROTOCOL_CONTRACT });
    const { agent, error } = await peer.starting;
    expect(error).toBeUndefined();
    expect(agent).toBeDefined();
    peer.send({
      method: zcodeProtocolNotifications.storageStartup,
      params: {
        schemaVersion: 1,
        attemptId: "fixture",
        databaseId: "fixture",
        databaseKind: "session",
        sequence: 1,
        phase: "ready",
        elapsedMs: 0,
      },
    });
    const first = agent!.call("session/read", { sessionId: "first" });
    const second = agent!.call("session/read", { sessionId: "second" });
    for (const sessionId of ["first", "second"]) {
      const request = await peer.requests.wait(
        (request) => (request.params as { sessionId?: string })?.sessionId === sessionId,
      );
      peer.send({ id: request.id, result: { sessionId } });
    }
    expect(await first).toEqual({ sessionId: "first" });
    expect(await second).toEqual({ sessionId: "second" });
    expect(peer.requests.history.map((request) => request.method)).toEqual([
      V4_METHODS.connectionInitialize,
      "session/read",
      "session/read",
    ]);
  });

  it.each([
    {
      protocolVersion: CURRENT_PROTOCOL_CONTRACT.protocolVersion + 1,
      capabilities: CURRENT_PROTOCOL_CONTRACT.capabilities,
    },
    { protocolVersion: CURRENT_PROTOCOL_CONTRACT.protocolVersion, capabilities: {} },
    {
      protocolVersion: CURRENT_PROTOCOL_CONTRACT.protocolVersion,
      capabilities: { workflowRunDeltas: false },
    },
  ])("rejects an incompatible CLI contract and closes the process: %j", async (contract) => {
    const peer = await startPeer();
    const initialize = await peer.requests.wait(() => true);
    peer.send({ id: initialize.id, result: contract });
    const { agent, error } = await peer.starting;
    expect(agent).toBeUndefined();
    expect(error).toBeInstanceOf(ZCodeProtocolContractError);
    expect(error).toMatchObject({
      code: "fault.protocol.incompatible",
      message: expect.stringContaining("Update or redeploy the paired Next components"),
    });
    expect(peer.isClosed()).toBe(true);
    expect(peer.requests.history).toHaveLength(1);
  });

  it("fails actionably when a CLI does not implement initialization", async () => {
    const peer = await startPeer();
    const initialize = await peer.requests.wait(() => true);
    peer.send({ id: initialize.id, error: { code: -32601, message: "Method not found" } });
    const { agent, error } = await peer.starting;
    expect(agent).toBeUndefined();
    expect(error).toBeInstanceOf(ZCodeProtocolContractError);
    expect(error).toMatchObject({
      code: "fault.protocol.incompatible",
      message: expect.stringContaining("Update or redeploy"),
      cause: expect.objectContaining({ code: -32601 }),
    });
    expect(peer.isClosed()).toBe(true);
    expect(peer.requests.history).toHaveLength(1);
  });
});
