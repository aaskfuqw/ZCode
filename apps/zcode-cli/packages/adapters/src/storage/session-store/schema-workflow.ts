export const WORKFLOW_SCHEMA_SQL = `
CREATE TABLE workflow_definition (
  id text primary key,
  name text not null,
  source text not null check(source in ('builtin', 'user')),
  trusted integer not null default 0 check(trusted in (0, 1)),
  enabled integer not null default 1 check(enabled in (0, 1)),
  script_path text,
  script_hash text not null,
  meta_json text not null,
  time_created integer not null,
  time_updated integer not null
, scope text not null default 'explicit'
  check(scope in ('builtin', 'explicit', 'project', 'user')));

CREATE TABLE workflow_run (
  id text primary key,
  definition_id text,
  name text not null,
  kind text not null default 'script',
  parent_session_id text references session(id) on delete set null,
  cwd text not null,
  script_path text,
  script_hash text not null,
  args_json text,
  args_hash text,
  status text not null check(status in (
    'pending',
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled'
  )),
  current_phase text,
  budget_total integer,
  budget_spent integer not null default 0,
  stats_json text,
  failure_json text,
  time_created integer not null,
  time_started integer,
  time_updated integer not null,
  time_completed integer
);

CREATE TABLE workflow_activity (
  id text primary key,
  run_id text not null references workflow_run(id) on delete cascade,
  parent_activity_id text,
  call_index integer not null,
  call_path text not null,
  attempt integer not null default 1,
  type text not null,
  phase text,
  label text,
  input_hash text not null,
  prompt text,
  opts_json text,
  status text not null check(status in (
    'queued',
    'running',
    'completed',
    'failed',
    'skipped',
    'cancelled',
    'cached',
    'lost'
  )),
  child_session_id text references session(id) on delete set null,
  result_json text,
  error_json text,
  time_created integer not null,
  time_started integer,
  time_updated integer not null,
  time_completed integer,
  unique(run_id, call_path, attempt)
);

CREATE TABLE workflow_event (
  id text primary key,
  run_id text not null references workflow_run(id) on delete cascade,
  sequence integer not null,
  type text not null,
  phase text,
  activity_id text references workflow_activity(id) on delete set null,
  payload_json text,
  time_created integer not null,
  unique(run_id, sequence)
);

CREATE TABLE session_task_link (
  id text primary key,
  root_workflow_run_id text references workflow_run(id) on delete cascade,
  parent_link_id text references session_task_link(id) on delete cascade,
  activity_id text references workflow_activity(id) on delete set null,
  parent_session_id text references session(id) on delete set null,
  child_session_id text not null references session(id) on delete cascade,
  role text not null,
  depth integer not null default 0,
  path text not null,
  phase text,
  label text,
  agent_type text,
  model text,
  status text not null,
  time_created integer not null,
  time_updated integer not null,
  unique(child_session_id)
);

CREATE TABLE dwf_run (
  id text primary key,
  parent_session_id text,
  cwd text,
  name text,
  script_text text,
  script_hash text,
  args_json text,
  tool_call_id text,
  resumed_from text,
  caps_max_concurrency integer not null,
  spent_tokens integer not null default 0,
  status text not null check(status in (
    'pending',
    'running',
    'completed',
    'failed',
    'cancelled'
  )),
  result_json text,
  failure_json text,
  time_created integer not null,
  time_updated integer not null
);

CREATE TABLE dwf_actor (
  id integer primary key autoincrement,
  run_id text not null references dwf_run(id) on delete cascade,
  site_id text not null,
  ordinal integer not null,
  name text,
  persona_json text,
  resolved_model text,
  session_id text,
  time_created integer not null,
  time_updated integer not null,
  unique(run_id, site_id, ordinal)
);

CREATE TABLE dwf_node (
  id integer primary key autoincrement,
  run_id text not null references dwf_run(id) on delete cascade,
  site_id text not null,
  ordinal integer not null,
  kind text not null check(kind in ('ask', 'world-read', 'world-run', 'report', 'artifact')),
  actor_site_id text,
  actor_ordinal integer,
  actor_seq integer,
  input_hash text not null,
  input_json text,
  status text not null check(status in ('running', 'completed', 'failed')),
  result_json text,
  error_json text,
  stats_json text,
  message_boundary integer,
  artifact_id text,
  time_created integer not null,
  time_updated integer not null,
  unique(run_id, site_id, ordinal)
);

CREATE TABLE dwf_event (
  id integer primary key autoincrement,
  run_id text not null references dwf_run(id) on delete cascade,
  sequence integer not null,
  type text not null,
  payload_json text not null,
  time_created integer not null,
  unique(run_id, sequence)
);

CREATE INDEX workflow_definition_source_idx
  on workflow_definition(source, enabled);

CREATE INDEX workflow_run_parent_session_idx
  on workflow_run(parent_session_id);

CREATE INDEX workflow_run_cwd_status_idx
  on workflow_run(cwd, status, time_updated desc);

CREATE INDEX workflow_run_definition_idx
  on workflow_run(definition_id);

CREATE INDEX workflow_activity_run_status_idx
  on workflow_activity(run_id, status, call_index);

CREATE INDEX workflow_activity_child_session_idx
  on workflow_activity(child_session_id);

CREATE INDEX workflow_event_run_sequence_idx
  on workflow_event(run_id, sequence);

CREATE INDEX session_task_link_root_workflow_idx
  on session_task_link(root_workflow_run_id, depth, path);

CREATE INDEX session_task_link_parent_idx
  on session_task_link(parent_link_id);

CREATE INDEX session_task_link_activity_idx
  on session_task_link(activity_id);

CREATE INDEX dwf_run_cwd_idx on dwf_run(cwd, time_updated);

CREATE INDEX dwf_actor_run_idx on dwf_actor(run_id);

CREATE INDEX dwf_node_run_idx on dwf_node(run_id);

CREATE INDEX dwf_node_artifact_idx on dwf_node(run_id, artifact_id);

CREATE INDEX dwf_event_artifact_idx
  on dwf_event(run_id, json_extract(payload_json, '$.artifactId'), sequence);
`;
