import { SESSION_SCHEMA_SQL } from "./schema-session.js";
import { USAGE_SCHEMA_SQL } from "./schema-usage.js";
import { WORKFLOW_SCHEMA_SQL } from "./schema-workflow.js";

export const SQLITE_SESSION_SCHEMA_ID = "0001_next_session_store";
export const SQLITE_SESSION_SCHEMA_SQL = [
  SESSION_SCHEMA_SQL,
  WORKFLOW_SCHEMA_SQL,
  USAGE_SCHEMA_SQL,
].join("\n");
