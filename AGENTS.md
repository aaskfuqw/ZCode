## Communication

- Use Simplified Chinese unless requested otherwise.
- Write agent-facing documentation in English.

## Core principles

- Before adding or changing behavior, establish the product rules, state owner, interfaces, and acceptance scenarios.
- Treat the checked-out source, `package.json`, and architecture policies as authoritative. Document only features, commands, and files that currently exist in this repository; remove references from instructions and skills when removing a feature.
- When investigating a problem, diagnose the cause before changing code unless a fix was explicitly requested. Combine source, logs, and runtime evidence, and distinguish confirmed causes from hypotheses.
- Preserve unrelated local changes. Do not restore removed modules or internal dependencies on your own.

## Commands and repository structure

Start work with `node scripts/check-workspace-freshness.mjs`. Use the Node version pinned in `mise.toml`.

Run these commands from the repository root:

| Purpose                         | Command                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| Type checking                   | `pnpm typecheck`                                                        |
| Lint                            | `pnpm lint` / `pnpm lint:fix`                                           |
| Formatting check                | `pnpm fmt:check`                                                        |
| Desktop development             | `pnpm dev:desktop`                                                      |
| Web development                 | `pnpm dev:web`                                                          |
| Pre-push checks                 | `pnpm verify:pre-push` (lint, architecture checks, affected unit tests) |
| Architecture check              | `pnpm architecture:check --changed`                                     |
| Module context                  | `pnpm architecture:context <module-id>`                                 |
| Unused dependencies and exports | `pnpm knip`                                                             |
| Export references               | `pnpm dep:refs --list-exports <file>`                                   |

Choose test commands from the target package's current `package.json` and actual test files; verify which unit and E2E entry points exist.

- `packages/desktop`: Electron main, host, and renderer.
- `packages/web`, `packages/server`: Web client and server.
- `packages/ui`: shared React components, hooks, and Zustand stores.
- `packages/services`: business services; `packages/rpc`: RPC framework.
- `packages/shared`: shared protocols and types; `packages/client`: Agent client SDK.
- `apps/zcode-cli`: Agent CLI and runtime.
- Read `CONTEXT.md` before changing plugin store UI; it defines the plugin store vocabulary.
- Read `DESIGN.md` before changing UI; it defines the UI design standards.

## Implementation and verification

- For code changes, use `.agents/skills/architecture-governance/SKILL.md`: run the architecture check first, then read the target module's controlled context.
- Keep one state owner and one write path. Establish interfaces, dependency direction, event order, and idempotency boundaries; do not hide synchronization problems with timeouts.
- Add corresponding tests before changing behavior. Interaction changes require E2E scenarios. Check that tests match the implementation and run the available verification; report checks that were not run or were limited by the environment.
- When fixing a bug, use Chinese comments to explain the cause and the evidence for the fix. Align with the user on design flaws before adding further fallback branches.
- Use a diagram to show ownership and event order for proposals involving state, timing, remote systems, or asynchronous synchronization.
- Run `pnpm typecheck` and `pnpm lint`, and report their actual results, including existing failures.
- Use asynchronous file and network IO. Import other packages through their public entry points and follow existing path aliases.
- UI must not call Repo directly; Service must not reference concrete Runtime implementations. Avoid cross-domain implementation imports and dependency cycles.

## UI and platform boundaries

- Follow `DESIGN.md`, reuse existing components, and support desktop and mobile Web layouts, interactions, themes, and internationalization.
- Components access services through `packages/ui/src/hooks/`. Route platform operations through `IPlatformService` (`packages/shared/src/platform.ts`), rather than calling `window.zcode` directly.
- Use dependency injection for Desktop, Web, local, and remote differences; support Windows, macOS, and Linux.
- Keep Zustand state in `packages/ui/src/store/`. Prevent broadcast loops for synchronized fields such as theme and language. Treat UI-local state according to its local scope, rather than as server truth.
- Use `.tsx` for hook files containing JSX.

## Processes, protocols, and remote control

- The Desktop app communicates with Agent over stdio. Update `packages/shared/src/zcode-protocol/index.ts` alongside protocol changes, with strict types and runtime validation.
- Main owns windows, native operations, process scheduling, and message forwarding; task/session business state belongs to its business owner.
- Each window has one window-scoped Local Host shared by local workspaces. A connection registry within that window manages remote workspaces; do not create another Desktop Remote Host.
- Mobile remote control attaches to an existing Desktop Host attachment and reuses the session runtime; do not start another Agent, Local Host, or remote session for mobile.
- Distinguish Desktop's `desktop-continuous` live delivery from mobile's `web-remote-replayable` recovery delivery. Verify both semantics when changing streams, snapshots, queues, or reconnection.
- External relay and Main handle only authentication, pairing, heartbeats, forwarding, and attachment scheduling; business owners retain queues, snapshots, and other business state.
- CLI/runtime `CommandInbox` serializes admission of accepted busy/running inputs. Renderer keeps only unsubmitted drafts and pending optimistic overlays; the Host owner/lease handles routing.
- Preserve owner/lease, cross-Host routing, and stale-run protection. Do not remove boundary checks based solely on one execution path.

## Workspace identity

- `workspaceIdentity` isolates identity; `workspacePath` serves file operations, command cwd, Git, and path display.
- Use `workspaceIdentity?.trim() || workspacePath` as the identity key for deduplication, binding, caches, queues, persistence, and request correlation.
- Pass both `workspaceIdentity` and `remoteSessionId` throughout remote flows; path-only matching is insufficient.
- Preserve local path fallback in new interfaces. Reuse existing remote identity constructors and parsers rather than writing identity formats in business code.

## Logging

- UI uses `packages/ui/src/logger.ts`; do not use `console.log` or `window.zcode?.log` directly.
- Agent/session/runtime services use `createServiceLogger(scope)` (`packages/services/src/logger/serviceLogger.ts`).
- `debug`: high-frequency diagnostics, including raw protocol data, streaming chunks, and individual tool updates; not persisted in production.
- `info`: production lifecycle events, including process/session lifecycle, permission outcomes, and one-time initialization.
- `warn`: recoverable exceptions; `error`: unrecoverable failures such as crashes, handshake failures, or authentication loss.
- Keep credentials, real user data, and internal service addresses out of logs, examples, and commits.

## Agent skills

### Issue tracker

Before reading or publishing issues, specs, or tickets, read `docs/agents/issue-tracker.md` for the GitHub Issues workflow in `aaskfuqw/ZCode`.

### Triage labels

Before assigning triage states, read `docs/agents/triage-labels.md` for the five canonical label mappings.

### Domain docs

Before exploring or designing a change, read `docs/agents/domain.md` for the single-context glossary and ADR rules.
