# ZCode

ZCode is a personal fork of the ZCode Desktop app: an Electron shell with a window-scoped Local Host, remote workspaces, a web client, and a mobile remote-control client.

## Language

**Update**:
Getting a newer build of this fork by pulling the repository and rebuilding it. The application itself never checks for, downloads, installs, or is blocked by a newer version, and no remote configuration can force one.
_Avoid_: auto update, auto upgrade, in-app update, in-app upgrade, forced update, force update, update prompt, "check for updates"

**Telemetry**:
Automatic collection and delivery of ZCode usage, stability, and performance observations for analysis or monitoring. Local troubleshooting logs, explicit log exports, and data required to operate or display a user feature are separate capabilities.
_Avoid_: using telemetry to mean all logs, business events, or user-visible usage

**Business device identity**:
A stable device identity required by ZCode's official model and subscription services. It remains the same when upgrading this fork and is independent of telemetry.
_Avoid_: telemetry identity, analytics device ID
