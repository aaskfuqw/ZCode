import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
export type AccountProviderMockScenario = "account-key";

export interface AccountProviderMockRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  keyCreation?: { name?: unknown; usageScene?: unknown };
}

export interface AccountProviderMockServer {
  baseUrl: string;
  scenario: AccountProviderMockScenario;
  stop(): Promise<void>;
}

interface AccountProviderMockState {
  clientConfigPayload: CodingPlanClientConfigFixture;
  scenario: AccountProviderMockScenario;
}

const DEFAULT_FULL_E2E_SPEC_GLOB = "./test/e2e/**/*.test.ts";

export function resolveAccountProviderMockScenario(
  specs: readonly string[],
): AccountProviderMockScenario | null {
  return specs.some((spec) => spec.includes("account-key-usage-scene")) ? "account-key" : null;
}

export function shouldPrepareAccountProviderMockForBuild(specs: readonly string[]): boolean {
  return (
    resolveAccountProviderMockScenario(specs) !== null ||
    specs.some((spec) => spec.replace(/\\/gu, "/") === DEFAULT_FULL_E2E_SPEC_GLOB)
  );
}

export async function resetAccountProviderMockServer(
  baseUrl: string,
  scenario: AccountProviderMockScenario,
): Promise<void> {
  const response = await fetch(`${baseUrl}/__e2e/coding-plan/reset`, {
    body: JSON.stringify({ scenario }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Coding Plan E2E mock reset failed: ${response.status} ${await response.text()}`,
    );
  }
}

export async function startAccountProviderMockServer(
  scenario: AccountProviderMockScenario = "account-key",
): Promise<AccountProviderMockServer> {
  // 修复原因：pnpm filter 会把 E2E cwd 切到 packages/desktop，不能用 cwd 定位仓库级 fixture。
  const clientConfigFixtureUrl = new URL(
    "../fixtures/coding-plan-client-configs.json",
    import.meta.url,
  );
  const baseClientConfigPayload = JSON.parse(
    await readFile(clientConfigFixtureUrl, "utf8"),
  ) as CodingPlanClientConfigFixture;
  const requests: AccountProviderMockRequest[] = [];
  const state = createAccountProviderMockState(baseClientConfigPayload, scenario);
  // 同套餐场景也供旧测试复用，不能隐式注入需要 release 的营销领取暂停。
  const server = createServer((request, response) => {
    void (async () => {
      await handleRequest(baseClientConfigPayload, state, requests, request, response);
    })().catch((error) => {
      if (!response.headersSent) {
        sendJson(response, { code: 500, msg: formatErrorMessage(error) }, 500);
        return;
      }
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Coding Plan E2E mock server did not bind to a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    get scenario() {
      return state.scenario;
    },
    stop: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

async function handleRequest(
  baseClientConfigPayload: CodingPlanClientConfigFixture,
  state: AccountProviderMockState,
  requests: AccountProviderMockRequest[],
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/__e2e/coding-plan/requests") {
    sendJson(response, { requests });
    return;
  }
  if (request.method === "POST" && url.pathname === "/__e2e/coding-plan/reset") {
    requests.length = 0;
    sendJson(response, { ok: true });
    return;
  }
  const recordedRequest = recordRequest(requests, request, url);
  if (request.method === "GET" && url.pathname === "/api/v1/client/configs") {
    sendJson(response, state.clientConfigPayload);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/zcode-plan/billing/balance") {
    sendJson(response, {
      code: 0,
      data: { server_time: Math.floor(Date.now() / 1000), plans: [], balances: [] },
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/monitor/usage/quota/limit") {
    sendJson(response, { code: 200, data: { level: "pro", limits: [] } });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/biz/subscription/list") {
    sendJson(response, {
      code: 200,
      data: [
        {
          productId: "glm-coding-pro-e2e",
          productName: "GLM Coding Pro",
          status: "VALID",
          inCurrentPeriod: true,
        },
      ],
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/biz/customer/getCustomerInfo") {
    sendJson(response, {
      code: 200,
      data: {
        organizations: [
          { organizationId: "org-e2e", projects: [{ projectId: "proj-e2e", projectType: 0 }] },
        ],
      },
    });
    return;
  }

  if (
    (request.method === "GET" || request.method === "POST") &&
    url.pathname === "/api/biz/v1/organization/org-e2e/projects/proj-e2e/api_keys"
  ) {
    if (request.method === "POST" && recordedRequest) {
      // 仅记录创建用途与名称，不把可能含凭据的任意请求体写入 E2E ledger。
      const { name, usageScene } = await readJsonBody<{
        name?: unknown;
        usageScene?: unknown;
      }>(request);
      recordedRequest.keyCreation = { name, usageScene };
    }
    sendJson(response, {
      code: 200,
      data:
        request.method === "GET"
          ? [{ name: "zcode", apiKey: "bigmodel-personal-api-key" }]
          : { name: "zcode", apiKey: "bigmodel-personal-api-key" },
    });
    return;
  }

  if (
    request.method === "POST" &&
    /^\/api\/biz\/v1\/organization\/org-e2e\/projects\/proj-e2e\/api_keys\/[^/]+\/access_tokens$/.test(
      url.pathname,
    )
  ) {
    const body = await readJsonBody<{ clientType?: string }>(request);
    if (body.clientType !== "zcode" || !request.headers.authorization?.startsWith("Bearer ")) {
      sendJson(response, { code: 400, msg: "invalid_token_request" });
      return;
    }
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${encode({ alg: "HS256", typ: "JWT", sign_type: "SIGN" })}.${encode({ token_use: "project_access", api_key: "e2e-key", exp: Math.floor(Date.now() / 1000) + 600 })}.e2e-signature`;
    sendJson(response, {
      code: 200,
      data: {
        enable: true,
        accessToken: token,
        tokenType: "Bearer",
        expiresIn: 600,
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      },
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/biz/subscription/enterprise/v2/pricing") {
    sendJson(response, { code: 200, data: { productList: [] } });
    return;
  }

  sendJson(
    response,
    {
      code: 404,
      msg: `Unhandled E2E mock path: ${request.method} ${url.pathname}`,
    },
    404,
  );
}

function createAccountProviderMockState(
  basePayload: CodingPlanClientConfigFixture,
  scenario: AccountProviderMockScenario,
): AccountProviderMockState {
  const clientConfigPayload = structuredClone(basePayload);
  populateAccountProviderCatalog(clientConfigPayload);
  return { clientConfigPayload, scenario };
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return (raw ? JSON.parse(raw) : {}) as T;
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

interface CodingPlanClientConfigFixture {
  data: {
    builtinProviders?: Array<{
      id?: string;
      name?: string;
      schema?: string;
      baseUrl?: string;
      models?: string[];
    }>;
    builtinModels?: Array<{
      modelId: string;
      name?: string;
      contextWindow?: number;
      maxCompletionTokens?: number;
      priority?: number;
    }>;
    configs: Record<string, unknown>;
  };
}

function populateAccountProviderCatalog(payload: CodingPlanClientConfigFixture) {
  payload.data.builtinProviders = [
    {
      id: "bigmodel",
      name: "BigModel - Coding Plan",
      schema: "anthropic",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      models: ["glm-5.1-highspeed"],
    },
    {
      id: "zai",
      name: "Z.ai - Coding Plan",
      schema: "anthropic",
      baseUrl: "https://api.z.ai/api/anthropic",
      models: ["glm-5.1-highspeed"],
    },
  ];
}

function recordRequest(requests: AccountProviderMockRequest[], request: IncomingMessage, url: URL) {
  if (url.pathname === "/__e2e/coding-plan/requests") {
    return;
  }
  const recorded: AccountProviderMockRequest = {
    method: request.method ?? "GET",
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: Object.fromEntries(
      Object.entries(request.headers).flatMap(([key, value]) => {
        if (Array.isArray(value)) return [[key, value.join(",")]];
        return typeof value === "string" ? [[key, value]] : [];
      }),
    ),
  };
  requests.push(recorded);
  return recorded;
}

function sendJson(response: ServerResponse, payload: unknown, statusCode = 200) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}
