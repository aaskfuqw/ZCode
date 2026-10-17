import { ZCODE_VERSION, type ZCodeEnv } from "@zcode/shared";

declare const __ZCODE_REMOTE_CDN_RELEASE_ROOTS__: readonly string[] | undefined;

export interface ResolveRemoteCdnOptions {
  env?: ZCodeEnv;
  locale?: string;
  timeZone?: string;
  overrideBaseUrl?: string;
  version?: string;
  now?: Date;
}

export function resolveRemoteCdnBaseUrls(options: ResolveRemoteCdnOptions = {}): string[] {
  const overrideBaseUrl = options.overrideBaseUrl?.trim();
  if (overrideBaseUrl) {
    return [normalizeBaseUrl(overrideBaseUrl)];
  }

  const version = options.version ?? ZCODE_VERSION;

  const configuredReleaseRoots =
    typeof __ZCODE_REMOTE_CDN_RELEASE_ROOTS__ === "undefined"
      ? []
      : __ZCODE_REMOTE_CDN_RELEASE_ROOTS__;
  // Only explicitly configured fork resources are eligible: upstream runtimes write upstream data.
  return configuredReleaseRoots
    .map((releaseRoot) => releaseRoot.trim())
    .filter(Boolean)
    .map((releaseRoot) => `${normalizeBaseUrl(releaseRoot)}/${version}`);
}

export function resolvePrimaryRemoteCdnBaseUrl(
  options: ResolveRemoteCdnOptions = {},
): string | undefined {
  return resolveRemoteCdnBaseUrls(options)[0];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
