import { afterEach, describe, expect, it } from "vitest";
import {
  resetAccountProviderMockServer,
  resolveAccountProviderMockScenario,
  shouldPrepareAccountProviderMockForBuild,
  startAccountProviderMockServer,
  type AccountProviderMockServer,
} from "./e2e/helpers/account-provider-mock-server.js";

describe("Account provider E2E control plane", () => {
  let server: AccountProviderMockServer | null = null;
  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it("selects the account-key case and prepares isolated full-suite builds", () => {
    expect(
      resolveAccountProviderMockScenario([
        "./test/e2e/manual-review/pending/account-key-usage-scene.test.ts",
      ]),
    ).toBe("account-key");
    expect(
      resolveAccountProviderMockScenario(["./test/e2e/provider-family-responsive.test.ts"]),
    ).toBeNull();
    expect(shouldPrepareAccountProviderMockForBuild(["./test/e2e/**/*.test.ts"])).toBe(true);
  });

  it("retains existing subscription, project-key creation and scoped token issuance", async () => {
    server = await startAccountProviderMockServer();
    const subscriptions = await fetch(`${server.baseUrl}/api/biz/subscription/list`).then(
      (response) => response.json(),
    );
    expect(subscriptions.data).toEqual([
      expect.objectContaining({ status: "VALID", inCurrentPeriod: true }),
    ]);
    const path = "/api/biz/v1/organization/org-e2e/projects/proj-e2e/api_keys";
    await fetch(server.baseUrl + path, {
      method: "POST",
      headers: { Authorization: "fixture-account-token", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "zcode-api-key", usageScene: 1 }),
    });
    const token = await fetch(`${server.baseUrl}${path}/fixture-key/access_tokens`, {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-account-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clientType: "zcode" }),
    }).then((response) => response.json());
    expect(token.data).toMatchObject({ tokenType: "Bearer", enable: true });
    const ledger = await fetch(`${server.baseUrl}/__e2e/coding-plan/requests`).then((response) =>
      response.json(),
    );
    expect(ledger.requests).toContainEqual(
      expect.objectContaining({ path, keyCreation: { name: "zcode-api-key", usageScene: 1 } }),
    );
  });

  it("clears request observations between workers", async () => {
    server = await startAccountProviderMockServer();
    await fetch(`${server.baseUrl}/api/biz/subscription/list`);
    await resetAccountProviderMockServer(server.baseUrl, "account-key");
    const ledger = await fetch(`${server.baseUrl}/__e2e/coding-plan/requests`).then((response) =>
      response.json(),
    );
    expect(ledger.requests).toEqual([]);
  });
});
