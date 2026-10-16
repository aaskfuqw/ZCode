# Remove in-app auto-update and the forced-update gate

_Status: accepted_

This fork builds the desktop app from its own source, so it cannot consume the upstream update feed, yet upstream's forced-update gate still blocked a packaged fork build at startup (remote `forceUpdate.minimalVersion`), and the gate's only "auto upgrade" action would have installed the vendor's own package over the fork. We therefore removed the entire desktop self-update subsystem — check, download, install, update entry point and update window, update IPC and settings, the build-time `ZCODE_AUTO_UPDATE` switch, and packaging update metadata — together with the forced-update gate, and added no replacement channel: an update is pulling the repository and rebuilding (see `GLOSSARY.md`).

## Considered Options

- **Keep the code, leave the build-time switch off.** Rejected: a dead switch is worse than no switch, because no feed exists that could serve it, and the forced-update gate would still read upstream config.
- **Point the existing updater at a fork-owned feed.** Rejected for now: it needs signed artifacts and a published feed. If in-app updates are ever wanted, that path should be designed on its own rather than reusing the upstream server-manifest protocol.
- **Keep the forced-update gate, replace its auto path with a download link.** Rejected: upstream release config could still stop a fork build from starting.

## Consequences

- A packaged fork build makes no update-related network requests and cannot be blocked at startup by upstream release configuration.
- Post-update release notes are no longer surfaced in the app; `pendingPostUpdateReleaseNotes`, `receivePreviewUpdates`, `autoDownloadAndInstallUpdates`, and `skippedElectronUpdateVersions` are dropped from `AppSettings`, and stale keys in existing `setting.json` files are stripped on the next write.
- Installers no longer carry `latest.yml` / `app-update.yml`, so in-app updating cannot be re-enabled by configuration alone; it requires a new implementation and a new decision.
