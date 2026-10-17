import { z } from "zod";
import { V4_WIRE_PROTOCOL_VERSION } from "./core.js";

export const CURRENT_PROTOCOL_CONTRACT = {
  protocolVersion: V4_WIRE_PROTOCOL_VERSION,
  capabilities: { workflowRunDeltas: true },
} as const;

export const protocolContractSchema = z
  .object({
    protocolVersion: z.literal(V4_WIRE_PROTOCOL_VERSION),
    capabilities: z.object({ workflowRunDeltas: z.literal(true) }).strict(),
  })
  .strict();

export class ZCodeProtocolContractError extends Error {
  readonly code = "fault.protocol.incompatible";

  constructor(cause?: unknown) {
    super(
      "Incompatible ZCode Next internal protocol. Update or redeploy the paired Next components.",
      { cause },
    );
    this.name = "ZCodeProtocolContractError";
  }
}

export function parseCurrentProtocolHandshake<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ZCodeProtocolContractError(result.error);
  return result.data;
}
