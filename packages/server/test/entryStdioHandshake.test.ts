import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_CONTRACT } from "@zcode/shared/zcode-protocol-v4";

let root: string;
let entry: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "zcode-stdio-admission-"));
  entry = join(root, "entry.cjs");
  const sideEffect = (name: string) => `process.stdout.write(${JSON.stringify(name + "\n")});`;
  const modules: Record<string, string> = {
    "@zcode/services/node": `export const disposeServiceResourcesAndWait = async () => {};
      export const getAppConfigDir = () => "/fixture";`,
    "./stdioDeviceMid.js": `export async function ensureRemoteServerDeviceMid() {
      ${sideEffect("device-mid")}
    }`,
    "./bundledZCodeBuiltinProviderConfig.js": `
      export const readBundledZCodeBuiltinProviderConfig = () => "fixture";
      export async function materializeBundledZCodeBuiltinProviderConfig() {
        ${sideEffect("provider-config")}
        return "/fixture/config";
      }`,
    "./stdioServices.js": `export function createStdioServices() {
      ${sideEffect("services")}
      return { authorityModeParseResult: { mode: "desktop-attached-remote" }, services: {} };
    }`,
    "./stdio.js": `export function createStdioServer() {
      ${sideEffect("rpc")}
      return { stop: async () => {} };
    }`,
    "./stdio-lifecycle.js": `export function registerStdioProcessLifecycle() {
      setImmediate(() => process.exit(0));
    }`,
  };
  await build({
    entryPoints: [resolve("packages/server/src/entry-stdio.ts")],
    outfile: entry,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
    plugins: [
      {
        name: "observe-stdio-business-initialization",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            path in modules ? { path, namespace: "fixture" } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
            contents: modules[path],
            loader: "js",
          }));
        },
      },
    ],
  });
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function sendAck(protocolContract: unknown) {
  const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });
  const lines: string[] = [];
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", resolveExit);
  });
  const hello = await new Promise<Record<string, unknown>>((resolveHello, reject) => {
    child.once("error", reject);
    createInterface({ input: child.stdout }).on("line", (line) => {
      lines.push(line);
      if (lines.length === 1) resolveHello(JSON.parse(line));
    });
    void exited.then(() => reject(new Error(`No hello: ${stderr}`)));
  });
  // The real entry is waiting on stdin; no fixture business dependency has been called.
  expect(lines).toHaveLength(1);
  expect(hello.protocolContract).toEqual(CURRENT_PROTOCOL_CONTRACT);
  child.stdin.end(
    JSON.stringify({
      type: "zcode-hello-ack",
      version: "different-product-version",
      clientId: "desktop",
      protocolContract,
    }) + "\n",
  );
  const code = await exited;
  return { code, business: lines.slice(1), stderr };
}

describe("remote Server stdio entry admission", () => {
  it("accepts the current ack before initializing device identity, provider files, services or RPC", async () => {
    const result = await sendAck(CURRENT_PROTOCOL_CONTRACT);
    expect(result.code).toBe(0);
    expect(result.business).toEqual(["device-mid", "provider-config", "services", "rpc"]);
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
    "rejects an incompatible Desktop before any business side effects: %j",
    async (protocolContract) => {
      const result = await sendAck(protocolContract);
      expect(result.code).toBe(1);
      expect(result.business).toEqual([]);
      expect(result.stderr).toContain("Update or redeploy the paired Next components");
    },
  );
});
