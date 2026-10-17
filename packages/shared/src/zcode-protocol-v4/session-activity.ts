import { z } from "zod";

/** Live runtime lifecycle for service scheduling; never a replayed conversation projection. */
export const sessionActivityEventSchema = z
  .object({
    sessionId: z.string().min(1),
    eventId: z.string().min(1),
    eventSeq: z.number().int().nonnegative(),
    turnId: z.string().min(1).optional(),
    kind: z.enum(["turn.started", "turn.terminal"]),
  })
  .strict();

export type SessionActivityEvent = z.infer<typeof sessionActivityEventSchema>;
