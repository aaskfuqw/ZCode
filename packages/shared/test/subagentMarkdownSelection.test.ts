import { describe, expect, it } from "vitest";
import {
  parseSubagentMarkdownSelection,
  formatSubagentMarkdownModel,
} from "../src/subagent-markdown-selection.js";

describe("Subagent 正式 Markdown 字段", () => {
  it("只读取 model/thoughtLevel，不读取未发布中间字段或结构化 model", () => {
    expect(
      parseSubagentMarkdownSelection({ modelSelection: { providerId: "p", modelId: "m" } }),
    ).toBeUndefined();
    expect(
      parseSubagentMarkdownSelection({ model: { providerId: "p", modelId: "m" } }),
    ).toBeUndefined();
    expect(
      parseSubagentMarkdownSelection({
        model: "p/m",
        thoughtLevel: "high",
        modelSelection: { providerId: "wrong", modelId: "wrong" },
      }),
    ).toEqual({ providerId: "p", modelId: "m", options: { reasoningLevel: "high" } });
  });
  it.each(["plain", "vendor/model", "model$variant", "模型:% /x"])(
    "模型 ID 无损往返 %s",
    (modelId) => {
      const selection = {
        providerId: "account:bigmodel-individual-coding-plan",
        modelId,
        options: { reasoningLevel: "high" },
      };
      expect(
        parseSubagentMarkdownSelection({
          model: formatSubagentMarkdownModel(selection),
          thoughtLevel: "high",
        }),
      ).toEqual(selection);
    },
  );
  it("普通读取不替换范围外的旧账号身份", () => {
    expect(
      parseSubagentMarkdownSelection({ model: "builtin:bigmodel-coding-plan/GLM" })?.providerId,
    ).toBe("builtin:bigmodel-coding-plan");
  });
  it.each(["custom:my-provider", "vendor/provider"])("Provider ID 无损往返 %s", (providerId) => {
    const selection = { providerId, modelId: "model" };
    expect(
      parseSubagentMarkdownSelection({ model: formatSubagentMarkdownModel(selection) }),
    ).toEqual(selection);
  });
  it.each(["inherit", "main", "sonnet", "opus", "haiku"])(
    "保留第三方 Markdown 继承值 %s",
    (model) => expect(parseSubagentMarkdownSelection({ model })).toBeUndefined(),
  );
});
