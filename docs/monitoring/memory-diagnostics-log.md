# Local process memory diagnostics

Desktop main, each window's Local Host, renderer, and workspace Agent CLI write bounded diagnostic samples into their existing local logs. No memory sample is exported through a reporting SDK or protocol notification.

## Ownership and lifecycle

- `packages/shared/src/memoryDiagnostics.ts` owns the common write gate, line formatter, and diagnostic counter registry.
- `packages/services/src/logger/nodeMemoryDiagnosticsLog.ts` samples `process.memoryUsage()` for Main and Local Host every 60 seconds. Each entry point starts one instance and stops it during shutdown.
- `packages/ui/src/lib/memoryDiagnostics.ts` samples the renderer's available heap values and UI counters. It writes through `packages/ui/src/logger.ts`; a Web runtime without the Desktop log bridge has no local file outlet.
- `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/runtime-maintenance.ts` shares one 60-second maintenance tick between local CLI memory logging, resident-session rebalance, event-store pruning, and detached-child publisher cleanup. Stopping the runtime stops the tick.

The first sample is logged. Later samples are logged when heap changes by more than 5%, RSS or external memory changes by more than 10%, any domain counter changes, or 300 seconds have elapsed since the last written sample. Sampling or logging failures drop that sample without blocking business operations.

## Evidence

A Desktop line contains `role`, `reason`, available `rssKb`, `heapUsedKb`, `heapTotalKb`, `externalKb`, `arrayBuffersKb`, and sorted domain counters. The CLI writes the equivalent structured event `zcode_protocol.process.memory_sample` into its own local JSONL log.

Counters come from existing owners: session records and event stores, publishers, service subscriptions, terminals, file watchers, UI projections and caches, task routing, browser guests, and windows. Counter providers only read sizes; they perform no IO or mutation. Samples contain no prompt, file contents, credentials, workspace paths, or session identifiers.

Desktop logs from Main, Host, and renderer use the existing local logging paths. Remote CLI logs remain on the remote machine. The existing explicit log export includes the relevant local log files.

Use changes in heap together with domain counters to locate retained JS state. RSS growth without heap growth points toward native or external allocations. Resource Manager remains the user-initiated view for live CPU and process memory queries.

## Verification

Shared write-gate tests cover first, changed, heartbeat, and counter failures. Service logger tests cover timer ownership, write gating, and shutdown. CLI maintenance tests cover cleanup and stop behavior. Renderer diagnostics tests cover its local log path.
