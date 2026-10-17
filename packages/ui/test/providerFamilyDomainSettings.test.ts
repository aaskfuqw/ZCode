import { appSettingsSchema } from "@zcode/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProviderFamilyDomain,
  resolveLogoutProviderFamilyDomain,
  setProviderFamilyDomain,
} from "@/lib/providerFamilyDomainSettings.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("current provider family domain settings", () => {
  it.each(["bigmodel", "zai"] as const)(
    "records OAuth selection for %s and preserves the other family",
    async (domain) => {
      vi.spyOn(Date, "now").mockReturnValue(500);
      const selections = {
        bigmodel: {
          kind: "team-coding-plan" as const,
          productId: "product",
          organizationId: "organization",
          projectId: "project",
        },
        zai: { kind: "start-plan" as const },
      };
      const settings = appSettingsSchema.parse({
        providerFamilyDomain: domain,
        providerFamilyConnectionSelections: selections,
      });
      const settingService = {
        get: vi.fn(async () => settings),
        update: vi.fn(async () => {}),
      };

      await setProviderFamilyDomain(settingService, domain);

      expect(settingService.update).toHaveBeenCalledExactlyOnceWith({
        providerFamilyDomain: domain,
        providerFamilyDomainUpdatedAt: 500,
        providerFamilyConnectionSelections: {
          ...selections,
          [domain]: { kind: "individual-coding-plan" },
        },
      });
      expect(settings.providerFamilyConnectionSelections).toEqual(selections);
    },
  );

  it("clears the domain through the current RPC value and records the selection time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(600);
    const settingService = { update: vi.fn(async () => {}) };

    await clearProviderFamilyDomain(settingService);

    expect(settingService.update).toHaveBeenCalledExactlyOnceWith({
      providerFamilyDomain: "",
      providerFamilyDomainUpdatedAt: 600,
    });
  });

  it("clears the current domain on logout", () => {
    expect(resolveLogoutProviderFamilyDomain({ currentDomain: "bigmodel" })).toBeNull();
  });
});
