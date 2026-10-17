import { afterEach, describe, expect, it, vi } from "vitest";
import { startProtocolRuntimeMaintenance } from "../src/zcode-protocol/runtime-maintenance.js";

afterEach(() => vi.useRealTimers());
describe("protocol runtime maintenance", () => {
  it("maintains resident sessions and detached publishers independently of reporting", () => {
    vi.useFakeTimers();
    const server = {
      rebalanceResidentSessions: vi.fn(),
      pruneSessionEventStores: vi.fn(),
      pruneDetachedChildPublishers: vi.fn(),
      collectMemoryDiagnostics: vi.fn(() => ({ residentSessions: 1 })),
    };
    const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Parameters<
      typeof startProtocolRuntimeMaintenance
    >[1];
    const maintenance = startProtocolRuntimeMaintenance(server, logger);
    vi.advanceTimersByTime(60_000);
    expect(server.rebalanceResidentSessions).toHaveBeenCalledTimes(1);
    expect(server.pruneSessionEventStores).toHaveBeenCalledTimes(1);
    expect(server.pruneDetachedChildPublishers).toHaveBeenCalledTimes(1);
    maintenance.stop();
    vi.advanceTimersByTime(60_000);
    expect(server.rebalanceResidentSessions).toHaveBeenCalledTimes(1);
  });
});
