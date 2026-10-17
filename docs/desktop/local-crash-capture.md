# Local Desktop crash capture

Desktop configures Electron Crashpad to keep local minidumps with upload disabled. `appCrashCaptureBootstrap.ts` initializes `desktopCrashCapture.ts` after the early data-directory bootstrap and before normal Main startup.

```text
<appConfigDir>/crash/
  live/       Electron / Crashpad output
  archive/    local diagnostic copies
```

The configuration directory follows the existing application data-directory setting. Startup archives leftover dumps from the previous run. Renderer and child-process crash hooks schedule another local archive pass.

The archive keeps the latest five dumps within a 100 MiB budget, always retaining the newest dump even if it exceeds the budget. Removing an old dump also removes its corresponding metadata; later cleanup retries orphan metadata. This existing retention policy applies to the local crash archive. It does not scan or remove historical telemetry state, queues, or logs.

Local dump capture and manual log export remain available. No crash collector SDK, upload endpoint, or automatic report is initialized.

Relevant implementation:

- `packages/desktop/src/main/desktopEarlyDataBaseDirBootstrap.ts`
- `packages/desktop/src/main/appCrashCaptureBootstrap.ts`
- `packages/desktop/src/main/desktopCrashCapture.ts`
- `packages/desktop/src/main/index.ts`
