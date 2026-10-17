# ZCode Next

ZCode Next is a personal fork of the ZCode Desktop app: an Electron shell with a window-scoped Local Host, remote workspaces, a web client, and a mobile remote-control client.

## Language

**ZCode Next**:
The independently evolving product maintained in this personal fork.
_Avoid_: ZCode when referring to this fork

**Upstream ZCode**:
The original ZCode product from which ZCode Next was forked.
_Avoid_: ZCode Next when referring to the upstream product

**Update**:
Getting a newer build of this fork by pulling the repository and rebuilding it. The application itself never checks for, downloads, installs, or is blocked by a newer version, and no remote configuration can force one.
_Avoid_: auto update, auto upgrade, in-app update, in-app upgrade, forced update, force update, update prompt, "check for updates"

**Telemetry**:
Automatic collection and delivery of ZCode usage, stability, and performance observations for analysis or monitoring. Local troubleshooting logs, explicit log exports, and data required to operate or display a user feature are separate capabilities.
_Avoid_: using telemetry to mean all logs, business events, or user-visible usage

**Business device identity**:
A stable device identity required by the official model and subscription services. ZCode Next has its own identity, preserved across Next upgrades and independent of telemetry and upstream ZCode's identity.
_Avoid_: telemetry identity, analytics device ID

**Marketing capability**:
ZCode functionality intended to acquire users or promote purchases, plan upgrades, referrals, or branded product sharing. Account authentication, official model access, subscription management, and truthful entitlement and usage information are operational capabilities.
_Avoid_: using marketing to mean all official service integration or entitlement checks

**Subscription management**:
A user-initiated visit to a provider's management page for a subscription the user already owns.
_Avoid_: using subscription management to mean an in-app purchase, upgrade, or renewal flow

**Start entitlement**:
A user's already-granted official Start allowance, with validity and remaining balance determined by the service. Acquiring a new free Start plan is separate from using that allowance.
_Avoid_: using Start entitlement to mean a free-plan promotion or a new claim

**Highspeed**:
An official-model acceleration capability that uses Highspeed cards. Its performance information includes task speed and estimated time saved.
_Avoid_: using Highspeed to mean only its promotional sharing material

**Promotional sharing**:
Branded Highspeed images and copy intended to promote ZCode or its official model offering. User-directed conversation sharing and factual task-performance information are separate capabilities.
_Avoid_: using promotional sharing to mean every share or export action
