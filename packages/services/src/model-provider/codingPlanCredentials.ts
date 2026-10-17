import { resolveHighspeedProviderId, type ZCodeAccountAccess } from "@zcode/shared";
import type { AccountRequestAuthResolver } from "./accountProviderRequestAuthService.js";
import { AccountRequestCredentialUnavailableError } from "./accountProviderRequestAuthService.js";

const ZCODE_JWT_TOKEN_KEY = "zcodejwttoken";
const ACTIVE_OAUTH_PROVIDER_KEY = "oauth:active_provider";

export type CodingPlanProviderFamily = "zai" | "bigmodel";
export type CodingPlanKind = "individual-coding-plan" | "team-coding-plan";

export interface CodingPlanCredentialSnapshot {
  jwt: string;
  codingPlanApiKey: string;
  accountScope?: string;
  providerFamily: CodingPlanProviderFamily;
  providerId: string;
  planKind: CodingPlanKind;
  organizationId?: string;
  projectId?: string;
}

export type CodingPlanUnsupportedReason =
  | "provider_identity_mismatch"
  | "start_plan_not_supported"
  | "connection_unavailable"
  | "selection_changed"
  | "jwt_missing";

export type CodingPlanSupport =
  | {
      supported: true;
      providerFamily: CodingPlanProviderFamily;
      providerId: string;
      planKind: CodingPlanKind;
    }
  | { supported: false; reason: CodingPlanUnsupportedReason };

export class CodingPlanCredentialsUnavailableError extends Error {
  constructor(readonly missing: "jwt" | "codingPlanApiKey") {
    super(
      missing === "jwt"
        ? "Coding Plan request requires zcode login (jwt missing)"
        : "Coding Plan request requires a Coding Plan provider credential",
    );
    this.name = "CodingPlanCredentialsUnavailableError";
  }
}

export class CodingPlanUnavailableError extends Error {
  constructor(readonly reason: CodingPlanUnsupportedReason) {
    super(`Selected Coding Plan is unavailable: ${reason}`);
    this.name = "CodingPlanUnavailableError";
  }
}

export interface CodingPlanCredentialResolverDeps {
  credentialService: { load(key: string): Promise<string | null | undefined> };
  accountRequestAuthService: Pick<AccountRequestAuthResolver, "resolveCurrent">;
  resolveAccountProvider(): Promise<{
    readonly providerId: string;
    readonly access: ZCodeAccountAccess;
    readonly baseURL?: string;
  } | null>;
}

function resolveSelectedCodingPlan(
  provider: Awaited<ReturnType<CodingPlanCredentialResolverDeps["resolveAccountProvider"]>>,
): {
  providerFamily: CodingPlanProviderFamily;
  providerId: string;
  planKind: CodingPlanKind;
  organizationId?: string;
  projectId?: string;
} {
  if (!provider) throw new CodingPlanUnavailableError("connection_unavailable");
  const { access, providerId } = provider;
  if (access.planKind === "start-plan") {
    throw new CodingPlanUnavailableError("start_plan_not_supported");
  }
  if (access.planKind !== "individual-coding-plan" && access.planKind !== "team-coding-plan") {
    throw new CodingPlanUnavailableError("connection_unavailable");
  }
  return {
    providerFamily: access.family,
    providerId,
    planKind: access.planKind,
    ...(access.planKind === "team-coding-plan"
      ? { organizationId: access.organizationId, projectId: access.projectId }
      : {}),
  };
}

function fingerprint(
  provider: Awaited<ReturnType<CodingPlanCredentialResolverDeps["resolveAccountProvider"]>>,
): string {
  return JSON.stringify(provider ?? null);
}

export async function resolveCodingPlanCredentials(
  deps: CodingPlanCredentialResolverDeps,
): Promise<CodingPlanCredentialSnapshot> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const provider = await deps.resolveAccountProvider();
    const selection = resolveSelectedCodingPlan(provider);
    const activeProvider =
      (await deps.credentialService.load(ACTIVE_OAUTH_PROVIDER_KEY))?.trim() ?? "";
    if (activeProvider !== selection.providerFamily) {
      throw new CodingPlanUnavailableError("provider_identity_mismatch");
    }
    const jwt = (await deps.credentialService.load(ZCODE_JWT_TOKEN_KEY))?.trim() ?? "";
    if (!jwt) throw new CodingPlanCredentialsUnavailableError("jwt");

    const [latestProvider, latestActiveProvider] = await Promise.all([
      deps.resolveAccountProvider(),
      deps.credentialService.load(ACTIVE_OAUTH_PROVIDER_KEY),
    ]);
    if (
      fingerprint(provider) !== fingerprint(latestProvider) ||
      activeProvider !== latestActiveProvider?.trim()
    ) {
      continue;
    }

    if (!provider || provider.access.family !== selection.providerFamily) {
      throw new CodingPlanUnavailableError("connection_unavailable");
    }
    try {
      const auth = await deps.accountRequestAuthService.resolveCurrent({
        providerId: selection.providerId,
        modelId: resolveHighspeedProviderId(selection.providerFamily),
        accountAccess: provider.access,
        reason: "highspeed",
      });
      const codingPlanApiKey = auth.apiKey?.trim() ?? "";
      if (!codingPlanApiKey) throw new CodingPlanCredentialsUnavailableError("codingPlanApiKey");
      return {
        jwt,
        codingPlanApiKey,
        providerFamily: selection.providerFamily,
        providerId: selection.providerId,
        planKind: selection.planKind,
        ...(auth.accountScope ? { accountScope: auth.accountScope } : {}),
        ...(selection.organizationId ? { organizationId: selection.organizationId } : {}),
        ...(selection.projectId ? { projectId: selection.projectId } : {}),
      };
    } catch (error) {
      if (error instanceof AccountRequestCredentialUnavailableError) {
        throw new CodingPlanCredentialsUnavailableError("codingPlanApiKey");
      }
      throw error;
    }
  }
  throw new CodingPlanUnavailableError("selection_changed");
}

export async function resolveCodingPlanSupport(
  deps: CodingPlanCredentialResolverDeps,
): Promise<CodingPlanSupport> {
  try {
    const credentials = await resolveCodingPlanCredentials(deps);
    return {
      supported: true,
      providerFamily: credentials.providerFamily,
      providerId: credentials.providerId,
      planKind: credentials.planKind,
    };
  } catch (error) {
    if (error instanceof CodingPlanUnavailableError) {
      return { supported: false, reason: error.reason };
    }
    if (error instanceof CodingPlanCredentialsUnavailableError) {
      return {
        supported: false,
        reason: error.missing === "jwt" ? "jwt_missing" : "connection_unavailable",
      };
    }
    throw error;
  }
}
