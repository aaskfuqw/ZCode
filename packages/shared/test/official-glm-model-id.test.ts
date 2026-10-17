import { describe, expect, it } from "vitest";
import { normalizeOfficialGlmModelId } from "../src/official-glm-model-id.js";

describe("官方 GLM ID 边界", () => {
  it("只规范化已知型号，不猜未知后缀", () => {
    expect(normalizeOfficialGlmModelId("glm-5.3-FLASH")).toBe("GLM-5.3-Flash");
    expect(normalizeOfficialGlmModelId("glm-4.7-flashx")).toBe("GLM-4.7-FlashX");
    expect(normalizeOfficialGlmModelId("glm-future-preview")).toBe("glm-future-preview");
    expect(normalizeOfficialGlmModelId("vendor/glm-5.3-flash")).toBe("vendor/glm-5.3-flash");
  });
});
