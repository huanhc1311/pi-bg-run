# AGENTS.md — pi-bg-run

## Project Overview

Pi extension for background process management. Provides `bg_run`, `bg_list`, `bg_kill` tools and `/bg` TUI panel. Published as npm package `pi-bg-run`.

## Architecture

- **Dependency injection**: `JobManager` receives all modules via constructor (`JobManagerDeps` interface). Tests inject mocks, production creates real instances in `src/index.ts`.
- **Feature-based layout**: Each module has one responsibility. Files under 80 lines.
- **Adaptive widget**: 500ms refresh with braille spinner when jobs running, 3000ms when idle.
- **Session-scoped**: Each Pi session gets its own `JobManager` instance, stored in `sessionManagers` Map keyed by session ID.

## Key Design Decisions

1. **Job ID format**: `bg_<random8>` — shorter than timestamped IDs, still unique
2. **Notification always triggers agent**: `triggerTurn: true` on completion — agent reads log automatically
3. **PID poll as fallback**: `child.on("close")` is primary, PID poll every `widgetRefreshMs` is backup for detached processes
4. **Sidecar persistence**: `jobs.json` in run dir (`/tmp/bg-run/<sessionId>/`) — enables recovery across session restarts
5. **Settings via Pi config**: `bgRun` key in settings.json, merged with hardcoded defaults

## Testing

- **Unit**: Vitest + mocks for each core module. `tests/unit/`
- **Integration**: Real processes, real filesystem. `tests/integration/`
- Run: `npm test` (all) / `npm run test:unit` / `npm run test:integration`

## File Map

| File | Exports | Purpose |
|---|---|---|
| `src/types.ts` | `Job`, `JobStatus`, `BgRunConfig`, `BgRunUserSettings` | Shared types |
| `src/config.ts` | `loadConfig(userSettings, runDir)` | Merge user settings with defaults |
| `src/core/process-spawner.ts` | `createProcessSpawner()` → `{ spawn, generateId }` | Spawn detached child processes |
| `src/core/process-monitor.ts` | `createProcessMonitor(pollMs)` → `{ watch, clear, clearAll }` | PID poll fallback |
| `src/core/process-killer.ts` | `createProcessKiller(timeoutMs)` → `{ kill, sendSignal }` | SIGTERM → SIGKILL escalation |
| `src/core/persistence.ts` | `createPersistence()` → `{ save, load, recover }` | Sidecar JSON persistence |
| `src/core/job-manager.ts` | `createJobManager(deps)` → `{ jobs, spawn, kill, list, init, shutdown }` | Central orchestrator |
| `src/ui/notifier.ts` | `createNotifier()` → `{ notify, flush }` | Batched notifications |
| `src/ui/widget.ts` | `createWidget(ttlMs)` → `{ refresh, start, stop }`, `SPINNER_FRAMES`, `ACTIVE_REFRESH_MS` | Braille spinner widget |
| `src/ui/panel.ts` | `createBgPanelComponent(...)` | Interactive TUI panel |
| `src/tools/bg-run.ts` | `createBgRunTool(getManager)`, `BgRunParams` | bg_run tool |
| `src/tools/bg-list.ts` | `createBgListTool(getManager)` | bg_list tool |
| `src/tools/bg-kill.ts` | `createBgKillTool(getManager)`, `BgKillParams` | bg_kill tool |
| `src/index.ts` | `default function(pi)` | Extension entry, DI wiring, lifecycle |
