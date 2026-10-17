import { describe, expect, it } from "vitest";
import type { ClientSceneConfig } from "@zcode/services";
import {
  materializeScheduledTemplateDraft,
  mapClientScenesToAutomationTemplates,
  resolveAutomationTemplateText,
} from "@/settings/automationTemplateCatalog.js";

function createScenes(cronExpr = "0 9 * * 1-5"): ClientSceneConfig[] {
  return [
    {
      namespace: "zcode",
      scene: "scheduled-task",
      options: {
        prompts: {
          id: "scheduled-prompts",
          type: "prompts",
          contents: {},
          items: [
            {
              id: "item-morningDevBrief",
              type: "prompts",
              contents: { cn: "中文定时指令", en: "English scheduled prompt" },
              labels: { cn: "晨会动态", en: "Morning dev brief" },
              defaults: { cronExpr: ["morning-cron"] },
            },
          ],
        },
        cronExpr: {
          id: "scheduled-cron",
          type: "cronExpr",
          contents: {},
          items: [
            {
              id: "morning-cron",
              type: "cronExpr",
              contents: { cn: cronExpr, en: cronExpr },
              labels: { cn: "错误的服务端外显", en: "Wrong server display" },
            },
          ],
        },
      },
    },
  ] as ClientSceneConfig[];
}

describe("Client Scenes automation template catalog", () => {
  it("uses referenced cron contents and keeps localized prompts", () => {
    const result = mapClientScenesToAutomationTemplates(createScenes(), () => true);
    expect(result.scheduled).toEqual([
      expect.objectContaining({
        id: "item-morningDevBrief",
        title: { cn: "晨会动态", en: "Morning dev brief" },
        prompt: { cn: "中文定时指令", en: "English scheduled prompt" },
        cronExpr: "0 9 * * 1-5",
        icon: "target",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("Wrong server display");
  });

  it("preserves the canonical Lucide img name and ignores URL-valued imgs", () => {
    const scenes = createScenes();
    scenes[0]!.options.prompts!.items![0]!.img = "  calendar-clock  ";
    scenes[0]!.options.prompts!.items![0]!.imgs = { cn: "https://cdn.example.com/icon.svg" };
    expect(mapClientScenesToAutomationTemplates(scenes, () => true).scheduled[0]).toMatchObject({
      iconName: "calendar-clock",
      icon: "target",
    });
  });

  it("rejects invalid cron, missing references, and schedules the editor cannot preserve", () => {
    const missing = createScenes();
    missing[0]!.options.prompts!.items![0]!.defaults = { cronExpr: ["missing"] };
    for (const [scenes, valid] of [
      [createScenes("invalid"), false],
      [missing, true],
      [createScenes("0 0 9 * * 1-5"), true],
    ] as const) {
      const result = mapClientScenesToAutomationTemplates(scenes, () => valid);
      expect(result.scheduled).toEqual([]);
      expect(result.rejectedScheduledTemplateIds).toEqual(["item-morningDevBrief"]);
    }
  });

  it("rejects blank titles and inconsistent localized schedules", () => {
    const blank = createScenes();
    blank[0]!.options.prompts!.items![0]!.labels = { cn: " ", en: "" };
    const mismatch = createScenes();
    mismatch[0]!.options.cronExpr!.items![0]!.contents.cn = "0 10 * * 1-5";
    for (const scenes of [blank, mismatch]) {
      expect(mapClientScenesToAutomationTemplates(scenes, () => true).scheduled).toEqual([]);
    }
  });

  it("freezes the localized draft independently of later catalog changes", () => {
    const scenes = createScenes();
    const template = mapClientScenesToAutomationTemplates(scenes, () => true).scheduled[0]!;
    const draft = materializeScheduledTemplateDraft(template, "zh-CN");
    scenes[0]!.options.prompts!.items![0]!.labels.cn = "changed";
    scenes[0]!.options.prompts!.items![0]!.contents.cn = "changed";
    expect(draft).toEqual({
      templateId: "item-morningDevBrief",
      title: "晨会动态",
      cronExpr: "0 9 * * 1-5",
      prompt: "中文定时指令",
    });
  });

  it("falls back to the other locale deterministically", () => {
    expect(resolveAutomationTemplateText({ cn: "中文", en: "English" }, "zh-CN")).toBe("中文");
    expect(resolveAutomationTemplateText({ en: "English" }, "zh-CN")).toBe("English");
    expect(resolveAutomationTemplateText({ cn: "中文" }, "en-US")).toBe("中文");
  });
});
