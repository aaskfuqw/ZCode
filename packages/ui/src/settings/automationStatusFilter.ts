/* Automations 列表状态筛选。 */
import {
  hasAutomationFailureState,
  resolveAutomationStatusKind,
} from "@/settings/automationFormat.js";

export type AutomationStatusFilter = "all" | "inProgress" | "completed" | "failed";
export type AutomationStatusFilterKind = Exclude<AutomationStatusFilter, "all">;

export const DEFAULT_AUTOMATION_STATUS_FILTER: AutomationStatusFilter = "all";
export const AUTOMATION_STATUS_FILTERS: readonly AutomationStatusFilter[] = [
  "all",
  "inProgress",
  "completed",
  "failed",
];

type AutomationFilterLike = Parameters<typeof resolveAutomationStatusKind>[0] &
  Parameters<typeof hasAutomationFailureState>[0];

export function resolveAutomationStatusFilterKind(
  automation: AutomationFilterLike,
): AutomationStatusFilterKind {
  if (hasAutomationFailureState(automation)) return "failed";
  return resolveAutomationStatusKind(automation) === "completed" ? "completed" : "inProgress";
}

export function filterAutomationsByStatus<T extends AutomationFilterLike>(
  automations: readonly T[],
  filter: AutomationStatusFilter,
): readonly T[] {
  if (filter === "all") return automations;
  return automations.filter(
    (automation) => resolveAutomationStatusFilterKind(automation) === filter,
  );
}
