import { join } from "node:path";
import {
  createNodeProviderConfigRuntime,
  PERSONAL_PROVIDER_CONFIG_FILE_NAME,
  type NodeProviderConfigRuntime,
  type NodeProviderConfigRuntimeOptions,
} from "@zcode/provider-node";
import { getAppConfigDir } from "../paths.js";

export { NodeProviderConfigRuntime as ProviderConfigRuntime } from "@zcode/provider-node";

export type ProviderConfigRuntimeOptions = Omit<
  NodeProviderConfigRuntimeOptions,
  "personalFilePath"
> & {
  readonly personalFilePath?: string;
};

/** Resolve the Next config location; provider-node remains the sole runtime owner. */
export function createProviderConfigRuntime(
  options: ProviderConfigRuntimeOptions,
): NodeProviderConfigRuntime {
  return createNodeProviderConfigRuntime({
    ...options,
    personalFilePath:
      options.personalFilePath ?? join(getAppConfigDir(), PERSONAL_PROVIDER_CONFIG_FILE_NAME),
  });
}
