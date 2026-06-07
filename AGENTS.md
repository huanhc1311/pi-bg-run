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
3. **Steer delivery mode**: `deliverAs: "steer"` ensures notifications arrive after the current tool call, not after the entire agent turn. This minimizes delay when the agent is busy.
4. **Deferred child unref**: `child.unref()` is called inside the `close`/`error` handler, not immediately after spawn. Keeping the child ref active ensures libuv polls the child handle every event loop iteration, so `close` events fire in ~1-5ms instead of being delayed by an unref'd handle.
5. **PID poll as fallback**: `child.on("close")` is primary (near-instant with deferred unref), PID poll is backup for edge cases where the close event doesn't fire.
6. **Sidecar persistence**: `jobs.json` in run dir (`/tmp/bg-run/<sessionId>/`) — enables recovery across session restarts
7. **Settings via Pi config**: `bgRun` key in settings.json, merged with hardcoded defaults

## Known Limitations

### Notification delay during tool calls

Notifications are delivered via `pi.sendMessage({ deliverAs: "steer" })`. Pi's messaging model cannot interrupt a running tool call. If the agent is executing a long tool (e.g., `bash` with a 10-second command), notifications queue and deliver after that tool call completes.

This is a **Pi framework limitation**, not a `pi-bg-run` bug. The delivery timeline is:

| Agent state | Notification delivery |
|---|---|
| Idle | Immediately (triggers new turn) |
| Running tool call | After current tool call finishes |
| LLM streaming | After current turn finishes |

### No cross-session notifications

Each `JobManager` is session-scoped. Notifications only reach the Pi session that spawned the job. If the session closes and a new one starts, the new session's `init()` recovers jobs from the sidecar, but completion notifications for jobs that finished during the gap are lost.

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
