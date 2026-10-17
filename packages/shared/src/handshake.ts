import { z } from "zod";
import { protocolContractSchema } from "./zcode-protocol-v4/connection-contract.js";

export const remoteHelloMessageSchema = z.object({
  type: z.literal("zcode-hello"),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  pid: z.number().int(),
  protocolContract: protocolContractSchema,
});

export type HelloMessage = z.infer<typeof remoteHelloMessageSchema>;

export const remoteHelloAckMessageSchema = z.object({
  type: z.literal("zcode-hello-ack"),
  version: z.string(),
  clientId: z.string().trim().min(1),
  protocolContract: protocolContractSchema,
});

export type HelloAckMessage = z.infer<typeof remoteHelloAckMessageSchema>;
