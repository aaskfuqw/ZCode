export const SESSION_SCHEMA_SQL = `
CREATE TABLE session (
  id text primary key,
  project_id text not null,
  workspace_id text,
  parent_id text,
  slug text not null,
  directory text not null,
  path text,
  title text not null,
  version text not null,
  share_url text,
  summary_additions integer,
  summary_deletions integer,
  summary_files integer,
  summary_diffs text,
  revert text,
  permission text,
  time_created integer not null,
  time_updated integer not null,
  time_compacting integer,
  time_archived integer
, task_type text not null default 'interactive', title_source text not null default 'first_input'
  check(title_source in ('default', 'first_input', 'generated', 'custom')), title_message_id text, time_title_updated integer, trace_id text);

CREATE TABLE message (
  id text primary key,
  session_id text not null references session(id) on delete cascade,
  time_created integer not null,
  time_updated integer not null,
  data text not null
, sequence integer);

CREATE TABLE part (
  id text primary key,
  message_id text not null references message(id) on delete cascade,
  session_id text not null,
  time_created integer not null,
  time_updated integer not null,
  data text not null
, sequence integer);

CREATE TABLE todo (
  session_id text not null references session(id) on delete cascade,
  content text not null,
  status text not null,
  priority text not null,
  position integer not null,
  time_created integer not null,
  time_updated integer not null,
  primary key(session_id, position)
);

CREATE TABLE session_entry (
  id text primary key,
  session_id text not null references session(id) on delete cascade,
  type text not null,
  time_created integer not null,
  time_updated integer not null,
  data text not null
);

CREATE TABLE permission (
  project_id text primary key,
  time_created integer not null,
  time_updated integer not null,
  data text not null
);

CREATE TABLE input_history (
  id text primary key,
  project_id text not null,
  session_id text,
  text text not null,
  kind text not null,
  time_created integer not null
, attachments text);

CREATE TABLE local_setting (
  scope text not null,
  scope_id text not null,
  namespace text not null,
  key text not null,
  value text not null,
  schema_version integer not null,
  time_created integer not null,
  time_updated integer not null,
  primary key(scope, scope_id, namespace, key)
);

CREATE TABLE "session_target" (
  session_id text primary key references session(id) on delete cascade,
  target_id text not null,
  objective text not null,
  status text not null check(status in ('active', 'paused', 'budget_limited', 'complete')),
  token_budget integer,
  tokens_used integer not null default 0,
  time_used_seconds integer not null default 0,
  time_created integer not null,
  time_updated integer not null
, summary_title text, active_input_id text, active_run_started_at integer, active_run_last_seen_at integer);

CREATE TABLE session_input (
  id text primary key,
  session_id text not null references session(id) on delete cascade,
  kind text not null,
  delivery text not null check(delivery in ('startNow', 'guide', 'queue')),
  payload text not null,
  admitted_sequence integer not null,
  promoted_sequence integer,
  promoted_message_id text,
  status text not null check(status in ('admitted', 'promoted', 'cancelled', 'discarded', 'failed')),
  status_reason text,
  time_created integer not null,
  time_updated integer not null
);

CREATE INDEX session_project_idx on session(project_id);

CREATE INDEX session_workspace_idx on session(workspace_id);

CREATE INDEX session_parent_idx on session(parent_id);

CREATE INDEX message_session_time_created_id_idx
  on message(session_id, time_created, id);

CREATE INDEX part_message_id_id_idx on part(message_id, id);

CREATE INDEX part_session_idx on part(session_id);

CREATE INDEX todo_session_idx on todo(session_id);

CREATE INDEX session_entry_session_idx on session_entry(session_id);

CREATE INDEX session_entry_session_type_idx on session_entry(session_id, type);

CREATE INDEX session_entry_time_created_idx on session_entry(time_created);

CREATE INDEX input_history_project_time_idx
  on input_history(project_id, time_created desc, id desc);

CREATE INDEX input_history_time_idx
  on input_history(time_created desc, id desc);

CREATE INDEX local_setting_scope_idx
  on local_setting(scope, scope_id);

CREATE INDEX local_setting_namespace_key_idx
  on local_setting(namespace, key);

CREATE INDEX session_task_type_idx on session(task_type);

CREATE INDEX session_trace_idx on session(trace_id);

CREATE INDEX message_session_sequence_idx
  on message(session_id, sequence, time_created, id);

CREATE INDEX part_message_sequence_idx
  on part(message_id, sequence, time_created, id);

CREATE INDEX part_session_message_sequence_idx
  on part(session_id, message_id, sequence);

CREATE INDEX session_input_session_admitted_idx
  on session_input(session_id, admitted_sequence);

CREATE INDEX session_input_session_status_idx
  on session_input(session_id, status);

CREATE TRIGGER message_sequence_autofill
after insert on message
when new.sequence is null
begin
  update message
  set sequence = (
    select coalesce(max(sequence), -1) + 1
    from message
    where session_id = new.session_id
  )
  where id = new.id;
end;

CREATE TRIGGER part_sequence_autofill
after insert on part
when new.sequence is null
begin
  update part
  set sequence = (
    select coalesce(max(sequence), -1) + 1
    from part
    where message_id = new.message_id
  )
  where id = new.id;
end;
`;
