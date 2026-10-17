import { afterEach, describe, expect, it, vi } from "vitest";
import { type ApiClient } from "@zcode/shared";
import {
  BigModelCodingPlanSubscriptionProvider,
  createBigModelLoginAuthHeaders,
  createZaiLoginAuthHeaders,
  resolveCodingPlanClientConfigUrl,
} from "../src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.js";
import { ZaiCodingPlanSubscriptionProvider } from "../src/coding-plan-subscription/zaiCodingPlanSubscriptionProvider.js";
function createBigModelCredentialService(token = "oauth-token") {
  return {
    load: vi.fn(async (key: string) => (key === "oauth:bigmodel:access_token" ? token : null)),
  };
}
import { createCodingPlanSubscriptionService } from "../src/coding-plan-subscription/codingPlanSubscriptionService.js";

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BigModelCodingPlanSubscriptionProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  it.each(["legacy", "preflight-v1", "unknown", undefined])(
    "预算固定 preflight-v1，不消费远端 strategy=%s 的缓存",
    async (strategy) => {
      const request = vi.fn(async () =>
        createJsonResponse({
          code: 0,
          data: { configs: { modelContextBudget: { strategy } } },
        }),
      );
      const provider = new BigModelCodingPlanSubscriptionProvider({
        apiClient: { request },
        credentialService: { load: vi.fn() },
      });
      // 由其他消费者填充真实共享缓存；预算不能再读出旧算法或发起刷新。
      await provider.getRequestVerificationConfig();
      request.mockClear();
      await expect(provider.getModelContextBudgetStrategy()).resolves.toBe("preflight-v1");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("配置永不返回时预算立即完成，不发请求也不启动超时器", async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => new Promise<Response>(() => {}));
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient: { request },
      credentialService: { load: vi.fn() },
    });
    let value: string | undefined;
    void provider.getModelContextBudgetStrategy().then((result) => {
      value = result;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(value).toBe("preflight-v1");
    expect(request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("预算读取不触发配置失败请求", async () => {
    const request = vi.fn(async () => {
      throw new Error("offline");
    });
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient: { request },
      credentialService: { load: vi.fn() },
    });
    await expect(provider.getModelContextBudgetStrategy()).resolves.toBe("preflight-v1");
    expect(request).not.toHaveBeenCalled();
  });
  it("client configs 根据 ZCODE_ENV 选择测试或生产环境", () => {
    expect(
      resolveCodingPlanClientConfigUrl({
        ZCODE_ENV: "test",
      }).toString(),
    ).toBe("https://zcode.z.ai/api/v1/client/configs");
    expect(
      resolveCodingPlanClientConfigUrl({
        ZCODE_ENV: "production",
        ZCODE_PRODUCTION_BASE_URL: "https://runtime.example.com",
      }).toString(),
    ).toBe("https://runtime.example.com/api/v1/client/configs");
  });
  it("getTeamConnections 登录态使用 BigModel OAuth token 且不添加 Bearer", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: { productList: [] },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    await provider.getTeamConnections();

    expect(apiClient.request).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
      "https://bigmodel.cn/api/biz/subscription/enterprise/v2/pricing",
    );
    expect(vi.mocked(apiClient.request).mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: {
        Authorization: "oauth-token",
        "Content-Type": "application/json",
      },
    });
  });

  it("getTeamConnections 会用 customerInfo 给已购 Team Plan 补齐项目上下文", async () => {
    const apiClient: ApiClient = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-0e2085",
                  tier: "PRO",
                  subscribeMode: "CONTINUOUS",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-team",
                  organizationName: "默认机构",
                  projects: [
                    {
                      projectId: "proj-default",
                      projectName: "团队编程套餐项目",
                      projectType: 1,
                    },
                    {
                      projectId: "proj-team",
                      projectName: "自定义团队项目",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          }),
        ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getTeamConnections();

    expect(result.productList[0]).toMatchObject({
      organizationId: "org-team",
      projectId: "proj-team",
      projectName: "自定义团队项目",
      teamProjects: [
        {
          organizationId: "org-team",
          projectId: "proj-team",
          projectName: "自定义团队项目",
        },
      ],
    });
  });

  it("getTeamConnections 已购 Team Plan 只有机构 ID 时仍从机构数组补齐项目上下文", async () => {
    const apiClient: ApiClient = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-0e2085",
                  tier: "PRO",
                  subscribeMode: "CONTINUOUS",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                  organizationId: "org-target",
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-other",
                  organizationName: "其他机构",
                  projects: [
                    {
                      projectId: "proj-other",
                      projectName: "其他团队项目",
                      projectType: 2,
                    },
                  ],
                },
                {
                  organizationId: "org-target",
                  organizationName: "目标机构",
                  projects: [
                    {
                      projectId: "proj-default",
                      projectName: "默认项目",
                      projectType: 1,
                    },
                    {
                      projectId: "proj-team",
                      projectName: "目标团队项目",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          }),
        ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getTeamConnections();

    expect(result.productList[0]).toMatchObject({
      organizationId: "org-target",
      organizationName: "目标机构",
      projectId: "proj-team",
      projectName: "目标团队项目",
      teamProjects: [
        {
          organizationId: "org-target",
          projectId: "proj-team",
          projectName: "目标团队项目",
        },
      ],
    });
  });

  it("getTeamConnections pricing 未标记订阅但 customerInfo 有团队项目时补 Team Plan 入口", async () => {
    const apiClient: ApiClient = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-max",
                  tier: "MAX",
                  subscribeMode: "CONTINUOUS",
                  subscribePeriod: "MONTHLY",
                  subscribed: false,
                },
                {
                  productId: "product-pro-monthly",
                  tier: "PRO",
                  subscribeMode: "ONE_TIME",
                  subscribePeriod: "MONTHLY",
                  subscribed: false,
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-default",
                  organizationName: "默认机构",
                  projects: [
                    {
                      projectId: "proj-default",
                      projectName: "默认项目",
                      projectType: 1,
                    },
                  ],
                },
                {
                  organizationId: "org-team",
                  organizationName: "团队机构",
                  projects: [
                    {
                      projectId: "proj-team",
                      projectName: "团队编程套餐项目",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          }),
        ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getTeamConnections();

    expect(
      result.productList.find((product) => product.productId === "product-pro-monthly"),
    ).toMatchObject({
      productId: "product-pro-monthly",
      subscribed: true,
      organizationId: "org-team",
      projectId: "proj-team",
      projectName: "团队编程套餐项目",
    });
  });

  it("getTeamConnections 会为多个已购 Team Plan 项目预热 zcode-team-api-key", async () => {
    const requestUrls: string[] = [];
    const requestMethods: Array<string | undefined> = [];
    const apiClient: ApiClient = {
      request: vi.fn(async (input, init) => {
        const url = input.toString();
        requestUrls.push(url);
        requestMethods.push(init?.method);
        if (url.endsWith("/api/biz/subscription/enterprise/v2/pricing")) {
          return createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-pro-monthly",
                  tier: "PRO",
                  subscribeMode: "ONE_TIME",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                },
              ],
            },
          });
        }
        if (url.endsWith("/api/biz/customer/getCustomerInfo")) {
          return createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-a",
                  organizationName: "团队 A",
                  projects: [
                    {
                      projectId: "proj-a",
                      projectName: "项目 A",
                      projectType: 2,
                    },
                  ],
                },
                {
                  organizationId: "org-b",
                  organizationName: "团队 B",
                  projects: [
                    {
                      projectId: "proj-b",
                      projectName: "项目 B",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          });
        }
        if (url.endsWith("/organization/org-a/projects/proj-a/api_keys")) {
          if (init?.method === "GET") {
            return createJsonResponse({
              code: 200,
              data: [{ apiKey: "team-a-ak", keyType: 2, name: "zcode-team-api-key" }],
            });
          }
        }
        if (url.endsWith("/organization/org-b/projects/proj-b/api_keys")) {
          if (init?.method === "GET") {
            return createJsonResponse({ code: 200, data: [] });
          }
          if (init?.method === "POST") {
            expect(init.headers).toMatchObject({
              "bigmodel-organization": "org-b",
              "bigmodel-project": "proj-b",
            });
            expect(JSON.parse(String(init.body))).toEqual({
              name: "zcode-team-api-key",
              keyType: 2,
              usageScene: 1,
            });
            return createJsonResponse({
              code: 200,
              data: {
                apiKey: "team-b-ak",
                keyType: 2,
                name: "zcode-team-api-key",
              },
            });
          }
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getTeamConnections();

    expect(result.productList[0]?.teamProjects).toHaveLength(2);
    expect(result.productList[0]?.teamProjects).toMatchObject([
      {
        organizationId: "org-a",
        projectId: "proj-a",
        apiKeyStatus: "available",
      },
      {
        organizationId: "org-b",
        projectId: "proj-b",
        apiKeyStatus: "available",
      },
    ]);
    expect(requestUrls).toEqual([
      "https://bigmodel.cn/api/biz/subscription/enterprise/v2/pricing",
      "https://bigmodel.cn/api/biz/customer/getCustomerInfo",
      "https://bigmodel.cn/api/biz/v1/organization/org-a/projects/proj-a/api_keys",
      "https://bigmodel.cn/api/biz/v1/organization/org-b/projects/proj-b/api_keys",
      "https://bigmodel.cn/api/biz/v1/organization/org-b/projects/proj-b/api_keys",
    ]);
    expect(requestMethods).toEqual(["GET", "GET", "GET", "GET", "POST"]);
  });

  it("getTeamConnections 单个 Team Plan 项目 key 预热失败不阻断其他团队", async () => {
    const requestUrls: string[] = [];
    const apiClient: ApiClient = {
      request: vi.fn(async (input, init) => {
        const url = input.toString();
        requestUrls.push(url);
        if (url.endsWith("/api/biz/subscription/enterprise/v2/pricing")) {
          return createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-pro-monthly",
                  tier: "PRO",
                  subscribeMode: "ONE_TIME",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                },
              ],
            },
          });
        }
        if (url.endsWith("/api/biz/customer/getCustomerInfo")) {
          return createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-a",
                  organizationName: "团队 A",
                  projects: [
                    {
                      projectId: "proj-a",
                      projectName: "项目 A",
                      projectType: 2,
                    },
                  ],
                },
                {
                  organizationId: "org-b",
                  organizationName: "团队 B",
                  projects: [
                    {
                      projectId: "proj-b",
                      projectName: "项目 B",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          });
        }
        if (url.endsWith("/organization/org-a/projects/proj-a/api_keys")) {
          throw new Error("org-a key failed");
        }
        if (
          url.endsWith("/organization/org-b/projects/proj-b/api_keys") &&
          init?.method === "GET"
        ) {
          return createJsonResponse({
            code: 200,
            data: [{ apiKey: "team-b-ak", keyType: 2, name: "zcode-team-api-key" }],
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getTeamConnections();

    expect(result.productList[0]?.teamProjects).toHaveLength(2);
    expect(result.productList[0]?.teamProjects).toMatchObject([
      {
        organizationId: "org-a",
        projectId: "proj-a",
        apiKeyStatus: "unavailable",
        apiKeyUnavailableReason: "request_failed",
      },
      {
        organizationId: "org-b",
        projectId: "proj-b",
        apiKeyStatus: "available",
      },
    ]);
    expect(requestUrls).toContain(
      "https://bigmodel.cn/api/biz/v1/organization/org-b/projects/proj-b/api_keys",
    );
  });

  it("getTeamConnections 会把没有有效团队套餐授权的 Team Plan 项目标为不可用", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async (input, init) => {
        const url = input.toString();
        if (url.endsWith("/api/biz/subscription/enterprise/v2/pricing")) {
          return createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-pro-monthly",
                  tier: "PRO",
                  subscribeMode: "ONE_TIME",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                },
              ],
            },
          });
        }
        if (url.endsWith("/api/biz/customer/getCustomerInfo")) {
          return createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-missing",
                  organizationName: "团队 Missing",
                  projects: [
                    {
                      projectId: "proj-missing",
                      projectName: "项目 Missing",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          });
        }
        if (
          url.endsWith("/organization/org-missing/projects/proj-missing/api_keys") &&
          init?.method === "GET"
        ) {
          return createJsonResponse({ code: 200, data: [] });
        }
        if (
          url.endsWith("/organization/org-missing/projects/proj-missing/api_keys") &&
          init?.method === "POST"
        ) {
          return createJsonResponse({
            code: 500,
            success: false,
            msg: "您当前暂无有效的团队套餐授权记录，无法创建API Key",
            data: null,
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getTeamConnections();

    expect(result.productList[0]?.teamProjects?.[0]).toMatchObject({
      organizationId: "org-missing",
      projectId: "proj-missing",
      apiKeyStatus: "unavailable",
      apiKeyUnavailableReason: "no_valid_team_plan_authorization",
      apiKeyUnavailableMessage: "您当前暂无有效的团队套餐授权记录，无法创建API Key",
    });
  });
  it("鉴权 header helper 只返回裸 token", () => {
    expect(createBigModelLoginAuthHeaders("token-1")).toEqual({
      Authorization: "token-1",
      "Content-Type": "application/json",
    });
  });

  it("Z.ai 鉴权 header helper 只返回裸登录 token", () => {
    expect(createZaiLoginAuthHeaders("zai-token")).toEqual({
      Authorization: "zai-token",
      "Content-Type": "application/json",
    });
  });
});

describe("ZaiCodingPlanSubscriptionProvider (family-aware Team Plan)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // 修复原因：开发机可能设了 ZAI_BUSINESS_BASE_URL=https://api.z.ai 环境变量，
  // resolveZaiBusinessBaseUrl 会优先读它，覆盖 ZCODE_ENV 逻辑导致测试域名断言不稳定。
  // 测试里统一 stub 成空，强制走 ZCODE_ENV fallback 链。
  function createZaiCredentialService(token = "zai-business-jwt") {
    return {
      load: vi.fn(async (key: string) => (key === "oauth:zai:access_token" ? token : null)),
    };
  }

  it("getTeamConnections 登录态使用 zai 域名 + zai OAuth token（非 bigmodel）", async () => {
    vi.stubEnv("ZAI_BUSINESS_BASE_URL", "");
    const apiClient: ApiClient = {
      request: vi.fn(async () => createJsonResponse({ code: 200, data: { productList: [] } })),
    };
    const provider = new ZaiCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createZaiCredentialService("zai-business-jwt"),
    });

    await provider.getTeamConnections();

    expect(apiClient.request).toHaveBeenCalledTimes(1);
    // 关键：host 是 zai 域名，不是 bigmodel.cn
    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
      "https://api.z.ai/api/biz/subscription/enterprise/v2/pricing",
    );
    // 关键：token 是 zai 的，不带 Bearer
    expect(vi.mocked(apiClient.request).mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: {
        Authorization: "zai-business-jwt",
        "Content-Type": "application/json",
      },
    });
  });

  it("ZCODE_ENV=test 时 zai Team Plan 企业接口使用 api.z.ai", async () => {
    vi.stubEnv("ZCODE_ENV", "test");
    // 开发机 ZAI_BUSINESS_BASE_URL 会覆盖 ZCODE_ENV fallback，这里 stub 成空强制走 fallback
    vi.stubEnv("ZAI_BUSINESS_BASE_URL", "");
    const apiClient: ApiClient = {
      request: vi.fn(async () => createJsonResponse({ code: 200, data: { productList: [] } })),
    };
    const provider = new ZaiCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createZaiCredentialService(),
    });

    await provider.getTeamConnections();

    // 关键：测试环境走 z.ai，不能把测试 token 发到生产 api.z.ai
    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
      "https://api.z.ai/api/biz/subscription/enterprise/v2/pricing",
    );
  });

  it("getTeamConnections 缺少 zai OAuth token 时抛 zai_oauth_required 且不请求", async () => {
    const apiClient: ApiClient = { request: vi.fn() };
    const provider = new ZaiCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: { load: vi.fn(async () => null) },
    });

    await expect(provider.getTeamConnections()).rejects.toThrow("zai_oauth_required");
    expect(apiClient.request).not.toHaveBeenCalled();
  });

  it("getTeamConnections 用 zai 域名的 customerInfo 给已购 Team Plan 补齐项目上下文", async () => {
    vi.stubEnv("ZAI_BUSINESS_BASE_URL", "");
    const requestUrls: string[] = [];
    const apiClient: ApiClient = {
      request: vi.fn(async (input) => {
        const url = input.toString();
        requestUrls.push(url);
        if (url.endsWith("/api/biz/subscription/enterprise/v2/pricing")) {
          return createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "zai-team-pro",
                  tier: "PRO",
                  subscribeMode: "CONTINUOUS",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                },
              ],
            },
          });
        }
        if (url.endsWith("/api/biz/customer/getCustomerInfo")) {
          return createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "zai-org",
                  organizationName: "zai 默认机构",
                  projects: [
                    {
                      projectId: "zai-proj",
                      projectName: "zai 团队项目",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          });
        }
        if (url.endsWith("/organization/zai-org/projects/zai-proj/api_keys")) {
          // team-api-key 预热：返回已有可用 key，避免 create 调用
          return createJsonResponse({
            code: 200,
            data: [{ apiKey: "zai-team-ak", keyType: 2, name: "zcode-team-api-key" }],
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    };
    const provider = new ZaiCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createZaiCredentialService("zai-token"),
    });

    const result = await provider.getTeamConnections();

    // 关键：pricing + customerInfo + team-api-key 预热都走 zai 域名，
    // 不能串到 bigmodel.cn。预热也必须用 zai host（符合"除购买外路径可复用"契约）。
    expect(requestUrls).toEqual([
      "https://api.z.ai/api/biz/subscription/enterprise/v2/pricing",
      "https://api.z.ai/api/biz/customer/getCustomerInfo",
      "https://api.z.ai/api/biz/v1/organization/zai-org/projects/zai-proj/api_keys",
    ]);
    expect(result.productList[0]).toMatchObject({
      organizationId: "zai-org",
      projectId: "zai-proj",
      projectName: "zai 团队项目",
    });
  });
});

describe("createCodingPlanSubscriptionService (family routing)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createCredentialService() {
    return {
      load: vi.fn(async (key: string) => {
        if (key === "oauth:bigmodel:access_token") return "bigmodel-token";
        if (key === "oauth:zai:access_token") return "zai-token";
        return null;
      }),
    };
  }

  it("getTeamConnections 缺省 family 时走 bigmodel 域名（向后兼容）", async () => {
    const requestUrls: string[] = [];
    const apiClient: ApiClient = {
      request: vi.fn(async (input) => {
        requestUrls.push(input.toString());
        return createJsonResponse({ code: 200, data: { productList: [] } });
      }),
    };
    const service = createCodingPlanSubscriptionService({
      apiClient,
      credentialService: createCredentialService(),
    });

    await service.getTeamConnections({});

    expect(requestUrls).toEqual(["https://bigmodel.cn/api/biz/subscription/enterprise/v2/pricing"]);
  });

  it("getTeamConnections family=bigmodel 走 bigmodel 域名 + bigmodel token", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () => createJsonResponse({ code: 200, data: { productList: [] } })),
    };
    const service = createCodingPlanSubscriptionService({
      apiClient,
      credentialService: createCredentialService(),
    });

    await service.getTeamConnections({
      family: "bigmodel",
    });

    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
      "https://bigmodel.cn/api/biz/subscription/enterprise/v2/pricing",
    );
    expect(vi.mocked(apiClient.request).mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "bigmodel-token" },
    });
  });

  it("getTeamConnections family=zai 走 zai 域名 + zai token", async () => {
    vi.stubEnv("ZAI_BUSINESS_BASE_URL", "");
    const apiClient: ApiClient = {
      request: vi.fn(async () => createJsonResponse({ code: 200, data: { productList: [] } })),
    };
    const service = createCodingPlanSubscriptionService({
      apiClient,
      credentialService: createCredentialService(),
    });

    await service.getTeamConnections({ family: "zai" });

    // 关键：service 层按 family 路由，zai 不能误用 bigmodel.cn
    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
      "https://api.z.ai/api/biz/subscription/enterprise/v2/pricing",
    );
    expect(vi.mocked(apiClient.request).mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "zai-token" },
    });
  });
});

describe("retained runtime configuration and team authentication", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  it("never substitutes other credentials when the BigModel account token is missing", async () => {
    const request = vi.fn();
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient: { request },
      credentialService: {
        load: vi.fn(async (key) => (key === "zcodejwttoken" ? "jwt-only" : null)),
      },
    });
    await expect(provider.getTeamConnections()).rejects.toThrow("bigmodel_oauth_required");
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects the historical JWT pollution before issuing a team request", async () => {
    const request = vi.fn();
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient: { request },
      credentialService: {
        load: vi.fn(async (key) =>
          key === "zcodejwttoken" || key === "oauth:bigmodel:access_token" ? "same-jwt" : null,
        ),
      },
    });
    await expect(provider.getTeamConnections()).rejects.toThrow("bigmodel_oauth_required");
    expect(request).not.toHaveBeenCalled();
  });
  it("coalesces operational config readers and refreshes the shared one-hour snapshot", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => createJsonResponse({ code: 0, data: { configs: {} } }));
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient: { request },
      credentialService: { load: vi.fn(async () => null) },
    });
    await Promise.all([
      provider.getRequestVerificationConfig(),
      provider.getRequestVerificationConfig(),
    ]);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 1);
    await provider.getRequestVerificationConfig();
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await provider.getRequestVerificationConfig();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
