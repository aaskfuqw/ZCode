import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const [automationsSectionSource, automationDesignPrimitivesSource] = await Promise.all([
  readFile(new URL("../src/settings/AutomationsSection.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/settings/AutomationDesignPrimitives.tsx", import.meta.url), "utf8"),
]);

describe("automation card border tokens", () => {
  it("uses the Card Border semantic token for cards and the empty state", () => {
    expect(automationsSectionSource).toContain(
      "rounded-xl border border-card-border bg-background",
    );
    expect(automationsSectionSource).toContain(
      "rounded-2xl border border-card-border bg-background",
    );
    expect(automationDesignPrimitivesSource).toContain(
      "rounded-xl border border-dashed border-card-border bg-background",
    );
  });

  it("does not use weaker surface borders for automation cards", () => {
    expect(automationsSectionSource).not.toContain(
      "rounded-xl border border-surface bg-background",
    );
    expect(automationsSectionSource).not.toContain(
      "rounded-2xl border border-surface bg-background",
    );
    expect(automationDesignPrimitivesSource).not.toContain('"border border-surface bg-background"');
  });
});
