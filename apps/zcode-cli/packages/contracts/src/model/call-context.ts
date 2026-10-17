export const ModelApiOperation = {
  AgentStep: "agent_step",
  ContextCompaction: "context_compaction",
  GoalTitle: "goal_title_generation",
  GoalVerification: "goal_completion_verification",
  GitCommitMessage: "workspace_git_commit_message",
  ProjectMemoryExtract: "project_memory_extract",
  ProjectMemoryDream: "project_memory_dream",
  ProjectMemoryRecall: "project_memory_recall",
  ReadSessionContextExtract: "read_session_context_extract",
  ReadSessionContextSynthesize: "read_session_context_synthesize",
  SessionTitle: "session_title_generation",
  ToolInternalModelCall: "tool_internal_model_call",
  WebFetch: "web_fetch_processing",
  WebSearch: "web_search",
  WorkspaceGenerateText: "workspace_generate_text",
} as const;

export type ModelApiOperation = (typeof ModelApiOperation)[keyof typeof ModelApiOperation];

export const ModelApiActorKind = {
  MainAgent: "main",
  Subagent: "subagent",
  WorkflowChild: "workflow_child",
  System: "system",
  Tool: "tool",
} as const;

export type ModelApiActorKind = (typeof ModelApiActorKind)[keyof typeof ModelApiActorKind];
export type ModelApiErrorPhase =
  | "prepare"
  | "configuration"
  | "connect"
  | "response"
  | "stream"
  | "parse"
  | "validation"
  | "unhandled";
export const ModelFailureExceptionKind = {
  ApiCall: "api_call",
  Generic: "generic",
  Protocol: "protocol",
  ProviderBusiness: "provider_business",
  Transport: "transport",
  TypeError: "type_error",
  Validation: "validation",
} as const;
export type ModelFailureExceptionKind =
  (typeof ModelFailureExceptionKind)[keyof typeof ModelFailureExceptionKind];
/** Business request classification used by provider session-type headers. */
export interface ModelApiCallObservation {
  operation?: ModelApiOperation;
  actorKind?: ModelApiActorKind;
}

export type ResolvedModelApiCallObservation = Required<ModelApiCallObservation>;

export function resolveModelApiCallObservation(
  querySource: string | undefined,
  context: ModelApiCallObservation | undefined,
): ResolvedModelApiCallObservation {
  const mapped = mapQuerySourceToModelApiOperation(querySource);
  return {
    operation: context?.operation ?? mapped.operation,
    actorKind: context?.actorKind ?? mapped.actorKind,
  };
}

function mapQuerySourceToModelApiOperation(querySource: string | undefined): {
  operation: ModelApiOperation;
  actorKind: ModelApiActorKind;
} {
  switch (querySource?.trim()) {
    case "main_turn":
      return { operation: ModelApiOperation.AgentStep, actorKind: ModelApiActorKind.MainAgent };
    case "subagent":
      return { operation: ModelApiOperation.AgentStep, actorKind: ModelApiActorKind.Subagent };
    case "workflow_child":
      return {
        operation: ModelApiOperation.AgentStep,
        actorKind: ModelApiActorKind.WorkflowChild,
      };
    case "compact":
      return {
        operation: ModelApiOperation.ContextCompaction,
        actorKind: ModelApiActorKind.System,
      };
    case "session_title":
      return {
        operation: ModelApiOperation.SessionTitle,
        actorKind: ModelApiActorKind.System,
      };
    case "goal_summary_title":
      return { operation: ModelApiOperation.GoalTitle, actorKind: ModelApiActorKind.System };
    case "target_completion_verification":
      return {
        operation: ModelApiOperation.GoalVerification,
        actorKind: ModelApiActorKind.System,
      };
    case "git_commit_message":
      return {
        operation: ModelApiOperation.GitCommitMessage,
        actorKind: ModelApiActorKind.System,
      };
    case "web_search_tool":
      return { operation: ModelApiOperation.WebSearch, actorKind: ModelApiActorKind.Tool };
    case "web_fetch_processing":
      return { operation: ModelApiOperation.WebFetch, actorKind: ModelApiActorKind.Tool };
    case "read_session_context":
      return {
        operation: ModelApiOperation.ReadSessionContextExtract,
        actorKind: ModelApiActorKind.Tool,
      };
    case "project_memory_extract":
      return {
        operation: ModelApiOperation.ProjectMemoryExtract,
        actorKind: ModelApiActorKind.System,
      };
    case "project_memory_dream":
      return {
        operation: ModelApiOperation.ProjectMemoryDream,
        actorKind: ModelApiActorKind.System,
      };
    case "project_memory_recall":
      return {
        operation: ModelApiOperation.ProjectMemoryRecall,
        actorKind: ModelApiActorKind.System,
      };
    default:
      return {
        operation: ModelApiOperation.ToolInternalModelCall,
        actorKind: ModelApiActorKind.System,
      };
  }
}
