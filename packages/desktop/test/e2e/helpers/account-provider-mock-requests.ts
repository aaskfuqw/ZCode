import type { AccountProviderMockRequest } from "./account-provider-mock-server.js";

export async function waitForAccountProviderMockRequest(
  predicate: (request: AccountProviderMockRequest) => boolean,
  timeoutMsg: string,
) {
  let latestRequests: AccountProviderMockRequest[] = [];
  let latestBaseUrls: string[] = [];
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = await readAccountProviderMockRequests();
    latestRequests = result.requests;
    latestBaseUrls = result.baseUrls;
    if (latestRequests.some(predicate)) {
      return;
    }
    await browser.pause(250);
  }
  throw new Error(
    `${timeoutMsg}，mock=${latestBaseUrls.join(" / ")}，当前请求: ${latestRequests
      .map(formatAccountProviderMockRequestForError)
      .join(" / ")}`,
  );
}

function formatAccountProviderMockRequestForError(request: AccountProviderMockRequest): string {
  const authorization = request.headers.authorization;
  const authState =
    authorization === undefined
      ? "auth=missing"
      : authorization.startsWith("Bearer ")
        ? "auth=bearer"
        : authorization.length > 0
          ? "auth=raw"
          : "auth=empty";
  return `${request.method} ${request.path} (${authState})`;
}

export async function readAccountProviderMockRequests(): Promise<{
  baseUrls: string[];
  requests: AccountProviderMockRequest[];
}> {
  const baseUrls = readAccountProviderMockBaseUrlCandidates();
  const requestGroups = await Promise.all(
    baseUrls.map(async (baseUrl) => {
      try {
        const response = await fetch(`${baseUrl}/__e2e/coding-plan/requests`);
        const payload = (await response.json()) as {
          requests?: AccountProviderMockRequest[];
        };
        return Array.isArray(payload.requests) ? payload.requests : [];
      } catch {
        return [];
      }
    }),
  );
  return {
    baseUrls,
    requests: requestGroups.flat(),
  };
}

function readAccountProviderMockBaseUrlCandidates(): string[] {
  const baseUrls = [
    process.env.ZCODE_ACCOUNT_PROVIDER_MOCK_BASE_URL,
    process.env.ZCODE_E2E_CODING_PLAN_MOCK_URL,
    process.env.BIGMODEL_TEST_API_BASE_URL,
    process.env.BIGMODEL_API_BASE_URL,
    process.env.ZAI_BUSINESS_BASE_URL,
    process.env.ZCODE_ENDPOINT_ORIGIN,
  ].flatMap((item) => {
    const value = item?.trim();
    return value ? [value] : [];
  });
  const uniqueBaseUrls = Array.from(new Set(baseUrls));
  if (uniqueBaseUrls.length === 0) {
    throw new Error("Coding Plan upgrade mock baseUrl 未配置");
  }
  return uniqueBaseUrls;
}
