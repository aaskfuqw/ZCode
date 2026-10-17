import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  ModelConfigRules,
  ModelConfig,
  ModelOptionSpecsConfig,
  ProviderConfigMap,
  ProviderConfigResolver,
  ProviderConfig,
  ZhipuAccountAccessConfig,
  createRegistryModelConfig,
  createRegistryProviderConfig,
  type ModelSelection,
  type ProviderRegistryServiceSnapshot,
} from "@zcode/provider";
import { NodeZCodeBuiltinProviderConfigSource } from "../src/index.js";
import { createNodeModelSelectionFacade } from "../src/model-selection-facade.js";

const source = new NodeZCodeBuiltinProviderConfigSource({
  bundledFilePath: fileURLToPath(
    new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
  ),
  watch: false,
});
let builtin: Awaited<ReturnType<typeof source.read>>;
beforeAll(async () => {
  builtin = await source.read();
});
afterAll(() => source.dispose());

function view(modelId: string, level: string, personalModels = ModelConfigRules.empty()) {
  const config = {
    revision: "c",
    zcodeBuiltinRevision: "b",
    personalRevision: "p",
    zcodeBuiltinProviders: builtin.providers,
    zcodeBuiltinProviderTemplates: builtin.templates,
    personalProviders: ProviderConfigMap.empty(),
    zcodeBuiltinModelRules: builtin.models,
    personalModels,
  };
  const account = {
    revision: "a",
    basedOnZCodeBuiltinRevision: "b",
    providers: new ProviderConfigMap([
      [
        "account:bigmodel-individual-coding-plan",
        new ProviderConfig({ access: new ZhipuAccountAccessConfig({ entitled: true }) }),
      ],
    ]),
    states: {
      "account:bigmodel-individual-coding-plan": {
        availability: "available" as const,
        entitled: true,
        current: true,
      },
    },
  };
  // 真实 Built-in 规则和 Resolver；补入模型成员用于独立覆盖 GLM 的不同代际。
  const resolution = new ProviderConfigResolver().resolve({
    ...config,
    accountProviders: account.providers,
    accountStates: account.states,
  });
  const providerId = "account:bigmodel-individual-coding-plan";
  const providerConfig = resolution.effectiveProviders.get(providerId)!;
  const modelConfig = ModelConfigRules.composeEffective(builtin.models, personalModels).resolve({
    providerId,
    modelId,
    apiType: providerConfig.api?.type,
    baseURL: providerConfig.api?.baseUrl,
  });
  const checkedModel = createRegistryModelConfig(modelConfig);
  const checkedProvider = createRegistryProviderConfig(providerConfig);
  if (!checkedModel.ok || !checkedProvider.ok)
    throw new Error(
      `fixture must be complete: ${JSON.stringify({ checkedModel, checkedProvider })}`,
    );
  const registry = {
    revision: 1,
    providers: [
      {
        providerId,
        config: checkedProvider.config,
        models: [{ modelId, config: checkedModel.config }],
      },
    ],
  };
  const snapshot: ProviderRegistryServiceSnapshot = {
    config,
    account,
    resolution,
    registry,
    sourceRevisions: { config: "c", account: "a" },
  };
  const facade = createNodeModelSelectionFacade({
    getSnapshot: () => snapshot,
    getView: () => registry,
    refresh: async () => snapshot,
    onDidChange: () => () => {},
  });
  const selection: ModelSelection = Object.freeze({
    providerId,
    modelId,
    options: Object.freeze({ reasoningLevel: level }),
  });
  return { result: facade.getView(undefined, undefined, { selection }), selection, facade };
}

describe("Node model selection uses current reasoning values", () => {
  it.each(["disabled", "high", "max"])("preserves current GLM-5.2 value %s", (level) => {
    const { result, selection, facade } = view("GLM-5.2", level);
    expect(result.selectionIssue).toBeUndefined();
    expect(result.effectiveSelection).toEqual(selection);
    expect(facade.getView(selection).preferredSelection).toEqual(selection);
  });
  it.each([
    ["GLM-5-Turbo", "off"],
    ["GLM-5.2", "nothink"],
    ["vendor/GLM-5.2:free", "nothink"],
  ])("rejects historical %s / %s without changing the original selection", (id, old) => {
    const { result, selection, facade } = view(id!, old!);
    expect(result.selectionIssue).toBe("reasoning-level-not-supported");
    expect(result.effectiveSelection?.options).toBeUndefined();
    expect(selection.options?.reasoningLevel).toBe(old);
    expect(facade.getView(selection).preferredSelection?.options?.reasoningLevel).not.toBe(old);
  });
  it.each([
    ["unknown-future", "off"],
    ["GLM-5.3", "nothink"],
    ["GLM-5.2", "off"],
    ["GLM-5.3", "none"],
    ["GLM-5.3", "typo"],
  ])("不猜 %s / %s", (id, old) => {
    expect(view(id!, old!).result.selectionIssue).toBe("reasoning-level-not-supported");
  });
  it("后续 Built-in values 覆盖旧规则时不恢复被覆盖的关闭值", () => {
    expect(view("GLM-5.3-Flash", "off").result.selectionIssue).toBe(
      "reasoning-level-not-supported",
    );
  });
  it("Personal 原值合法则保留；自定义值域不套用内置别名", () => {
    const personal = (values: string[]) =>
      new ModelConfigRules([
        {
          type: "provider-model",
          providerId: "account:bigmodel-individual-coding-plan",
          modelId: "GLM-5.2",
          config: new ModelConfig({
            optionSpecs: new ModelOptionSpecsConfig({ reasoningLevel: { values } }),
          }),
        },
      ]);
    expect(
      view("GLM-5.2", "nothink", personal(["nothink", "high"])).result.effectiveSelection?.options
        ?.reasoningLevel,
    ).toBe("nothink");
    expect(view("GLM-5.2", "nothink", personal(["disabled", "high"])).result.selectionIssue).toBe(
      "reasoning-level-not-supported",
    );
  });
});
