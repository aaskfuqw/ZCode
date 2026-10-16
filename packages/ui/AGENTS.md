# UI development rules

This file supplements the [root rules](../../AGENTS.md) for components, pages, styles, hooks, and UI state changes.

## Design and platforms

- Read [DESIGN.md](../../DESIGN.md) before changing UI. Follow its rules for color, hierarchy, sizing, typography, corner radii, component reuse, responsiveness, themes, and internationalization.
- Check desktop and mobile Web. Use the current light and dark themes defined by DESIGN for visual verification and account for text length across languages.
- Route platform operations through `usePlatform()` / `IPlatformService`, rather than calling `window.zcode` directly. Inject platform implementations: see [desktopPlatform.ts](../desktop/src/renderer/src/desktopPlatform.ts) for Desktop and [main.tsx](../web/src/main.tsx) for Web.

## Services and state

- Components access services through [hooks](src/hooks/), which use `useServices()`; components must not obtain services or access Repo directly. Reuse existing hooks and check the source for current exports.
- Use [Zustand stores](src/store/) and StoreProvider, subscribing through selectors such as `useZCodeStore(selector)`. Preserve the existing Provider dependency order and keep services and business state in their existing owners.
- Cross-window fields such as theme and locale synchronize through broadcastService channels prefixed with `state:`. Preserve the `applyingBroadcast` loop prevention when applying broadcasts.
- See the [runtime boundaries](../../docs/agents/runtime-boundaries.md) for ownership of task/session state and submitted inputs. UI owns drafts and display projections; accepted input queues remain with their runtime owner.
- Use `.tsx` for hooks and Provider files containing JSX.

## Debugging and verification

- Use [src/logger.ts](src/logger.ts) for logging to the console and local files; do not call `console.log` or `window.zcode.log` directly.
- Diagnose interaction bugs with logs or browser/CDP execution evidence. Keep Chinese comments that explain non-obvious root causes.
- Maintain E2E coverage for interaction changes according to the root verification rules. Verify desktop/mobile and themes for purely visual changes. Apply existing React skills when relevant to a React task.
