import { z } from "zod";

export const ToolCommandStatusSchema = z.enum([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "spawn_error",
  "backgrounded",
]);

export type ToolCommandStatus = z.infer<typeof ToolCommandStatusSchema>;
