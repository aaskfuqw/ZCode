import { ensureCliDeviceMid } from "@zcode/adapters";
import { arch as readOsArch, release as readOsRelease } from "node:os";
import {
  buildZCodeSourceHeadersFromContext,
  resolveRuntimeZCodeEndpointOrigin,
  resolveRuntimeZCodeEnv,
  ZCODE_APP_VERSION_ENV,
} from "@zcode/shared";
import type { ModelProviderSourceTitle } from "./model-config.js";

interface CreateProviderEndpointRoutingSourceHeadersOptions {
  appVersion?: string;
  env?: NodeJS.ProcessEnv;
  sourceTitle?: ModelProviderSourceTitle;
}

export async function createProviderEndpointRoutingSourceHeaders(
  options: CreateProviderEndpointRoutingSourceHeadersOptions = {},
): Promise<Record<string, string>> {
  const env = options.env ?? process.env;
  const deviceMid = await ensureCliDeviceMid({ env });
  return buildZCodeSourceHeadersFromContext({
    appVersion: env[ZCODE_APP_VERSION_ENV] ?? options.appVersion,
    arch: readOsArch(),
    clientLanguage: resolveClientLanguage(),
    clientTimezone: resolveClientTimezone(),
    deviceMid,
    endpointOrigin: resolveRuntimeZCodeEndpointOrigin(env),
    osVersion: readOsRelease(),
    platform: process.platform,
    releaseChannel: resolveRuntimeZCodeEnv(env),
    sourceTitle: options.sourceTitle ?? "cli",
  });
}

function resolveClientLanguage(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

function resolveClientTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
