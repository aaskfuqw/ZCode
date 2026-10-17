import { z } from "zod";
import { modelSelectionSchema } from "@zcode/shared/model-selection";
import {
  parsePersonalModelConfigRules,
  parsePersonalProviderConfigMap,
  type ProviderConfigLayerUpdate,
} from "@zcode/provider";

const CURRENT_SCHEMA_VERSION = 1 as const;

const storedProviderConfigSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    config: z
      .object({
        providerOrder: z.array(z.string().min(1)).optional(),
        providerConfigRules: z.unknown(),
        modelConfigRules: z.unknown(),
        defaultModelSelection: modelSelectionSchema.optional(),
      })
      .strict(),
  })
  .strict();

export class UnsupportedProviderConfigVersionError extends Error {
  readonly version: number | null;

  constructor(message: string, version: number | null) {
    super(message);
    this.name = "UnsupportedProviderConfigVersionError";
    this.version = version;
  }
}

export function decodeProviderConfigFile(input: unknown): ProviderConfigLayerUpdate {
  const version = readSchemaVersion(input);
  if (version === null) {
    throw new UnsupportedProviderConfigVersionError("Provider Config 缺少 schemaVersion", null);
  }
  if (version !== CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedProviderConfigVersionError(
      `Provider Config schemaVersion ${version} 不受支持；仅支持当前格式 ${CURRENT_SCHEMA_VERSION}`,
      version,
    );
  }
  const parsed = storedProviderConfigSchema.parse(input);
  return Object.freeze({
    providers: parsePersonalProviderConfigMap(parsed.config.providerConfigRules),
    models: parsePersonalModelConfigRules(parsed.config.modelConfigRules),
    providerOrder: parsed.config.providerOrder,
    ...(parsed.config.defaultModelSelection === undefined
      ? {}
      : { defaultModelSelection: parsed.config.defaultModelSelection }),
  });
}

export function encodeProviderConfigFile(update: ProviderConfigLayerUpdate) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    config: {
      ...(update.providerOrder === undefined ? {} : { providerOrder: update.providerOrder }),
      providerConfigRules: { providerRules: update.providers.toJSON() },
      modelConfigRules: update.models.toPersonalJSON(),
      ...(update.defaultModelSelection === undefined
        ? {}
        : { defaultModelSelection: update.defaultModelSelection }),
    },
  };
}

function readSchemaVersion(input: unknown): number | null {
  if (!isRecord(input) || !("schemaVersion" in input)) return null;
  const version = input.schemaVersion;
  if (!Number.isInteger(version) || (version as number) < 0) {
    throw new UnsupportedProviderConfigVersionError(
      "Provider Config schemaVersion 必须是非负整数",
      null,
    );
  }
  return version as number;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
