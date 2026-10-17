import { assertCurrentZCodeMcpConfig } from "@zcode/shared";

const OBSOLETE_MODEL_CONFIG_KEYS = ["provider", "model", "small_model"] as const;

export class ObsoleteCliModelConfigError extends Error {
  constructor(filePath: string) {
    super(
      `Incompatible legacy CLI model/provider configuration at ${JSON.stringify(filePath)}. Configure models in the current provider_config.json file (respecting ZCODE_PERSONAL_PROVIDER_CONFIG_FILE), then manually remove the obsolete model/provider keys from this config. Keep all project and workspace files.`,
    );
    this.name = "ObsoleteCliModelConfigError";
  }
}

export function assertCurrentCliConfig(value: unknown, filePath: string): void {
  assertCurrentZCodeMcpConfig(value, filePath);
  if (
    value !== null &&
    typeof value === "object" &&
    OBSOLETE_MODEL_CONFIG_KEYS.some((key) => Object.hasOwn(value, key))
  )
    throw new ObsoleteCliModelConfigError(filePath);
}
