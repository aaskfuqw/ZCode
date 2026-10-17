import type { Logger } from "@zcode/contracts";
import {
  createMemorySampleWriteGate,
  memoryUsageToSampleFields,
  MEMORY_SAMPLE_INTERVAL_MS,
  type MemorySample,
} from "@zcode/shared";
import type { ZCodeProtocolAgentServer } from "./server.js";

export interface ProtocolRuntimeMaintenance {
  stop(): void;
}

/** Maintenance has its own lifecycle; reporting must never own session retention. */
export function startProtocolRuntimeMaintenance(
  server: Pick<
    ZCodeProtocolAgentServer,
    | "rebalanceResidentSessions"
    | "pruneSessionEventStores"
    | "pruneDetachedChildPublishers"
    | "collectMemoryDiagnostics"
  >,
  logger: Logger,
): ProtocolRuntimeMaintenance {
  const gate = createMemorySampleWriteGate();
  const timer = setInterval(() => {
    try {
      server.rebalanceResidentSessions();
      server.pruneSessionEventStores();
      server.pruneDetachedChildPublishers();
    } catch (error) {
      logger.warn("Runtime maintenance failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
    try {
      const sample: MemorySample = {
        role: "agent_node",
        ...memoryUsageToSampleFields(process.memoryUsage()),
        counters: server.collectMemoryDiagnostics(),
      };
      const reason = gate.evaluate(sample, Date.now());
      if (reason) {
        const { role: _role, ...fields } = sample;
        logger.info("Process memory sample", {
          event: "zcode_protocol.process.memory_sample",
          reason,
          ...fields,
        });
      }
    } catch {
      // Local diagnostics must not affect session maintenance.
    }
  }, MEMORY_SAMPLE_INTERVAL_MS);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
