// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnterpriseCodingPlanPricingResponse, ProviderFamilyDomain } from "@zcode/shared";

const service = vi.hoisted(() => ({ getTeamConnections: vi.fn() }));
vi.mock("@/hooks/useServices.js", () => ({
  useOptionalServices: () => ({ codingPlanSubscriptionService: service }),
}));
import { useEnterpriseCodingPlanProducts } from "@/settings/model-provider-section/useEnterpriseCodingPlanProducts.js";

function deferred() {
  let resolve!: (value: EnterpriseCodingPlanPricingResponse) => void;
  const promise = new Promise<EnterpriseCodingPlanPricingResponse>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const connections = (id: string): EnterpriseCodingPlanPricingResponse => ({
  productList: [
    {
      productId: id,
      tier: "PRO",
      subscribeMode: "CONTINUOUS",
      subscribePeriod: "MONTHLY",
      subscribed: true,
      organizationId: "org",
      projectId: "project",
    },
  ],
});
beforeEach(() => service.getTeamConnections.mockReset());
afterEach(cleanup);

describe("existing team connection discovery", () => {
  it("does not query an anonymous catalog and clears connections when signed out", async () => {
    service.getTeamConnections.mockResolvedValue(connections("team"));
    const { result, rerender } = renderHook(
      ({ authenticated }) => useEnterpriseCodingPlanProducts({ enabled: true, authenticated }),
      { initialProps: { authenticated: false } },
    );
    expect(service.getTeamConnections).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
    rerender({ authenticated: true });
    await waitFor(() => expect(result.current.snapshot?.productList[0]?.productId).toBe("team"));
    rerender({ authenticated: false });
    await waitFor(() => expect(result.current.snapshot).toBeNull());
    expect(service.getTeamConnections).toHaveBeenCalledOnce();
  });

  it("rejects a late response from a previous account family", async () => {
    const old = deferred();
    service.getTeamConnections
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(connections("zai-team"));
    const { result, rerender } = renderHook(
      ({ family }: { family: ProviderFamilyDomain }) =>
        useEnterpriseCodingPlanProducts({ enabled: true, authenticated: true, family }),
      { initialProps: { family: "bigmodel" as ProviderFamilyDomain } },
    );
    rerender({ family: "zai" });
    await waitFor(() => expect(result.current.snapshot?.family).toBe("zai"));
    await act(async () => {
      old.resolve(connections("old-bigmodel-team"));
      await old.promise;
    });
    expect(result.current.snapshot?.productList[0]?.productId).toBe("zai-team");
    expect(service.getTeamConnections.mock.calls).toEqual([
      [{ family: "bigmodel" }],
      [{ family: "zai" }],
    ]);
  });

  it("ignores an in-flight result after its connection source is disabled", async () => {
    const pending = deferred();
    service.getTeamConnections.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(
      ({ enabled }) => useEnterpriseCodingPlanProducts({ enabled, authenticated: true }),
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    await act(async () => {
      pending.resolve(connections("late-team"));
      await pending.promise;
    });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
