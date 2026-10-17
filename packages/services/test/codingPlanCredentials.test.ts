import { describe, expect, it, vi } from "vitest";
import type { ZCodeAccountAccess } from "@zcode/shared";
import {
  CodingPlanUnavailableError,
  resolveCodingPlanCredentials,
  resolveCodingPlanSupport,
  type CodingPlanCredentialResolverDeps,
} from "../src/model-provider/codingPlanCredentials.js";

function fixture(family: "zai" | "bigmodel", team = false) {
  const access: ZCodeAccountAccess = team
    ? {
        type: "zhipu-account",
        family,
        planKind: "team-coding-plan",
        organizationId: "org",
        projectId: "project",
      }
    : { type: "zhipu-account", family, planKind: "individual-coding-plan" };
  const provider = { providerId: `account:${family}-${access.planKind}`, access };
  const resolveCurrent = vi.fn(async () => ({ apiKey: "plan-token", accountScope: "scope" }));
  const deps: CodingPlanCredentialResolverDeps = {
    credentialService: {
      load: vi.fn(async (key) =>
        key === "oauth:active_provider" ? family : key === "zcodejwttoken" ? "login-jwt" : null,
      ),
    },
    accountRequestAuthService: { resolveCurrent },
    resolveAccountProvider: vi.fn(async () => provider),
  };
  return { deps, provider, resolveCurrent };
}

describe("Coding Plan credentials for Highspeed", () => {
  it.each(["zai", "bigmodel"] as const)(
    "resolves current %s individual and team scopes through the account owner",
    async (family) => {
      for (const team of [false, true]) {
        const { deps, provider, resolveCurrent } = fixture(family, team);
        expect(await resolveCodingPlanCredentials(deps)).toEqual({
          jwt: "login-jwt",
          codingPlanApiKey: "plan-token",
          accountScope: "scope",
          providerFamily: family,
          providerId: provider.providerId,
          planKind: provider.access.planKind,
          ...(team ? { organizationId: "org", projectId: "project" } : {}),
        });
        expect(resolveCurrent).toHaveBeenCalledWith(
          expect.objectContaining({
            providerId: provider.providerId,
            accountAccess: provider.access,
            reason: "highspeed",
          }),
        );
      }
    },
  );

  it("rejects a login from another family before requesting a plan token", async () => {
    const { deps, resolveCurrent } = fixture("zai");
    deps.credentialService.load = async (key) =>
      key === "oauth:active_provider" ? "bigmodel" : "login-jwt";
    await expect(resolveCodingPlanCredentials(deps)).rejects.toMatchObject({
      reason: "provider_identity_mismatch",
    });
    expect(resolveCurrent).not.toHaveBeenCalled();
  });

  it("retries a changed selection and never uses the stale project scope", async () => {
    const old = fixture("bigmodel");
    const current = fixture("bigmodel", true);
    old.deps.resolveAccountProvider = vi
      .fn()
      .mockResolvedValueOnce(old.provider)
      .mockResolvedValue(current.provider);
    expect(await resolveCodingPlanCredentials(old.deps)).toMatchObject({
      planKind: "team-coding-plan",
      projectId: "project",
    });
    expect(old.resolveCurrent).toHaveBeenCalledTimes(1);
    expect(old.resolveCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ accountAccess: current.provider.access }),
    );
  });

  it("fails a continually changing selection without minting credentials", async () => {
    const { deps, provider, resolveCurrent } = fixture("bigmodel");
    let version = 0;
    deps.resolveAccountProvider = async () => ({ ...provider, providerId: `changed-${++version}` });
    await expect(resolveCodingPlanCredentials(deps)).rejects.toEqual(
      new CodingPlanUnavailableError("selection_changed"),
    );
    expect(resolveCurrent).not.toHaveBeenCalled();
  });

  it("reports unavailable support when the login JWT is absent", async () => {
    const { deps, resolveCurrent } = fixture("bigmodel");
    deps.credentialService.load = async (key) =>
      key === "oauth:active_provider" ? "bigmodel" : null;
    expect(await resolveCodingPlanSupport(deps)).toEqual({
      supported: false,
      reason: "jwt_missing",
    });
    expect(resolveCurrent).not.toHaveBeenCalled();
  });
});
