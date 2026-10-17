# Development data and paired components

ZCode Next has no release baseline yet. It supports the current data formats and internal protocol contracts described in [ADR 0006](adr/0006-retire-pre-release-compatibility-debt.md). Old development databases and configuration formats may be incompatible; they are not automatically migrated or erased.

## Reset only the affected store

Use the exact file path in the error or copied startup diagnostics. Quit every Next Desktop, Server, Host, and CLI process using that file. Back up the file before manually moving it aside, then restart Next to initialize current state.

For SQLite databases, move the database and any matching `-wal` and `-shm` sidecars together after all users have closed the database. Do not remove the whole data directory: `.zcode-next/workspace/default` contains a real working directory, and other stores may still be valid.

| Affected state                                   | Default location                                      | Reset consequence                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Task index, groups, and automations              | `<data base>/.zcode-next/v2/tasks-index.sqlite`       | Recreates the current task index, grouping, and automation store.                                    |
| CLI sessions and their persisted execution state | `<home>/.zcode-next/cli/db/db.sqlite`                 | Recreates the current CLI session store. Existing conversations in that database become unavailable. |
| Application settings                             | `<settings home>/.zcode-next/v2/setting.json`         | Restores current default preferences and connection selections.                                      |
| Personal provider configuration                  | The `provider_config.json` path reported by its owner | Requires configuring personal providers and models again.                                            |
| Bot or subagent state                            | The specific file reported by its owner               | Recreates only that bot or subagent configuration/state file.                                        |

The task data base follows the configured `setDataBaseDir` value, then `ZCODE_DATA_BASE_DIR`, then the startup home directory. The settings home instead follows `ZCODE_DESKTOP_HOME_DIR`, `HOME`, `USERPROFILE`, then the operating-system home. CLI and provider configuration can have their own explicit paths. A custom data base does not imply every store moved with it; the reported file path is authoritative.

For a CLI MCP configuration error, edit the exact reported `config.json` rather than removing the whole file. Use `enabled` on each `mcp.servers` entry and remove obsolete directory-path overrides from `mcp`. Preserve server connection details and unrelated settings. Desktop, Host, and CLI reject these old fields without rewriting the file. Third-party `.agents/mcp.json` files retain their own format and are not migrated during reads.

Keep project source, workspace files, upstream ZCode data, unrelated configuration, and all backups. Resetting a current file is a deliberate manual action; removing an old importer does not require deleting its old source files.

## Internal protocol mismatch

First-party Desktop, Web, Server, CLI, and remote Agent components must speak the current paired internal contracts. When a connection is rejected, rebuild or redeploy the corresponding Next components through their existing workflow, and refresh the Web client when applicable. Product version numbers alone do not establish protocol compatibility.

Normal reconnect, owner/lease routing, stale-run protection, Desktop continuous delivery, and mobile replay remain current behavior. Current external model services, OAuth providers, MCP servers, and third-party formats retain their own integration contracts.
