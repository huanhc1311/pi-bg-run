# pi-bg-run Design Document

**Date:** 2026-06-07
**Status:** Approved
**Package:** `pi-bg-run`
**License:** MIT

## Overview

Extract `~/.pi/agent/extensions/bg-run.ts` (~350 lines single-file extension) into a standalone, publishable Pi package. The package provides background process management for the Pi coding agent — spawn long-running commands, monitor them, and notify the agent on completion.

## Goals

- **Maintainability** — Each file < 80 lines, single responsibility
- **Testability** — Unit + integration tests with full coverage
- **Extensibility** — Easy to add features (job scheduling, log streaming) without touching existing code
- **Reusability** — Published as `pi-bg-run` on npm, installable via `pi install npm:pi-bg-run`
- **Community-ready** — README, AGENTS.md, examples, configurable via Pi settings

## Non-Goals

- Remote execution (SSH, containers)
- Log streaming / real-time tail
- Job scheduling / cron
- Multi-user / access control
- Breaking the 3-tool API surface (bg_run, bg_list, bg_kill)

## Project Structure

```
pi-bg-run/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── AGENTS.md
├── README.md
├── LICENSE
├── src/
│   ├── index.ts                 # Extension entry point
│   ├── types.ts                 # Shared types (Job, JobStatus, Config)
│   ├── config.ts                # Settings loader with defaults
│   ├── core/
│   │   ├── job-manager.ts       # Orchestrator - composes modules
│   │   ├── process-spawner.ts   # spawn, detach, log fd management
│   │   ├── process-monitor.ts   # PID poll + close event tracking
│   │   ├── persistence.ts       # Sidecar JSON read/write/recover
│   │   └── process-killer.ts    # SIGTERM → SIGKILL escalation
│   ├── ui/
│   │   ├── notifier.ts          # Notification batching + formatting
│   │   ├── widget.ts            # Widget + status bar periodic refresh
│   │   └── panel.ts             # /bg TUI panel component
│   └── tools/
│       ├── bg-run.ts            # bg_run tool definition + renderers
│       ├── bg-list.ts           # bg_list tool definition + renderers
│       └── bg-kill.ts           # bg_kill tool definition + renderers
└── tests/
    ├── unit/
    │   ├── process-spawner.test.ts
    │   ├── process-monitor.test.ts
    │   ├── process-killer.test.ts
    │   ├── persistence.test.ts
    │   ├── notifier.test.ts
    │   ├── job-manager.test.ts
    │   └── config.test.ts
    └── integration/
        ├── spawn-complete.test.ts
        ├── kill-escalation.test.ts
        ├── recovery.test.ts
        └── concurrent-jobs.test.ts
```

## Architecture

### Dependency Flow

```
index.ts (entry point)
  ├── registers tools (bg_run, bg_list, bg_kill)
  ├── registers /bg command
  ├── on session_start → creates JobManager
  └── on session_shutdown → calls JobManager.shutdown()

JobManager (orchestrator)
  ├── ProcessSpawner   — creates detached child processes
  ├── ProcessMonitor   — tracks process liveness via PID polling
  ├── ProcessKiller    — graceful SIGTERM → SIGKILL escalation
  ├── Persistence      — sidecar JSON save/load/recover
  ├── Notifier         — batches and sends completion notifications
  └── Widget           — periodic widget + status bar refresh
```

### Module Interfaces

#### ProcessSpawner
```typescript
interface ProcessSpawner {
  spawn(command: string, runDir: string): { pid: number; logPath: string; child: ChildProcess };
}
```
- Creates detached child process via `spawn("sh", ["-c", command])`
- Opens log file descriptor, passes as stdio
- Calls `child.unref()` for background execution
- Throws on spawn failure (caller handles)

#### ProcessMonitor
```typescript
interface ProcessMonitor {
  watch(jobId: string, pid: number, onExit: () => void): () => void;
}
```
- Sets up PID poll interval (configurable via `widgetRefreshMs`)
- Also listens to `child.on("close")` as primary signal
- Returns unwatch function for cleanup
- Guards against double-fire (close event + poll detecting exit simultaneously)

#### ProcessKiller
```typescript
interface ProcessKiller {
  kill(pid: number, timeoutMs: number): Promise<void>;
}
```
- Sends SIGTERM to process group (`process.kill(-pid, "SIGTERM")`)
- Falls back to `process.kill(pid, "SIGTERM")` if group kill fails
- After `timeoutMs`, escalates to SIGKILL
- Resolves when process is confirmed dead

#### Persistence
```typescript
interface Persistence {
  save(jobs: Job[], sidecarPath: string): void;
  load(sidecarPath: string): Job[];
  recover(jobs: Job[]): Job[];
}
```
- `save`: Write jobs array as JSON to sidecar file
- `load`: Parse sidecar file, handle corrupted/missing gracefully
- `recover`: For running jobs, check PID validity. Dead PIDs → mark completed with null exitCode. Live PIDs → keep as running.

#### Notifier
```typescript
interface Notifier {
  notify(job: Job, pi: ExtensionAPI): void;
  flush(pi: ExtensionAPI, sync: boolean): void;
}
```
- Batches notifications within 50ms window
- Single job: icon + status + duration + log path
- Multiple jobs: numbered list format
- `flush(sync: true)` for shutdown — drains all pending immediately
- Always sends via `pi.sendMessage` with `triggerTurn: true, deliverAs: "followUp"`

#### Widget
```typescript
interface Widget {
  refresh(jobs: Job[], ctx: ExtensionContext): void;
  start(getJobs: () => Job[], ctx: ExtensionContext): void;
  stop(): void;
}
```
- `refresh`: Renders running + recent completed jobs as widget lines
- `start`: Sets up periodic refresh interval. **Adaptive rate:** 500ms when running jobs exist (for spinner animation), 3000ms when only completed/failed jobs remain.
- `stop`: Clears interval
- Also updates status bar with running job count

**Braille spinner for running jobs:**
- Frames: `⣾ ⣽ ⣻ ⢿ ⡿ ⣟ ⣯ ⣷` (8 frames)
- Each running job shows a spinning braille character instead of static icon
- **Staggered:** Each job's frame offset = `(job.startedAt / 1000) % 8`, so multiple running jobs show different phases simultaneously — visual indication of independent processes
- Completed/failed/killed jobs keep static emoji icons (✅ ❌ 🔴)

#### Panel (BgPanelComponent)
- Unchanged logic from current implementation
- Keyboard: `↑/↓` navigate, `Enter` view log tail, `k` kill (double-press confirm), `q/Esc` quit
- Renders job list with icons, elapsed time, log preview

### JobManager (Orchestrator)
```typescript
class JobManager {
  jobs: Map<string, Job>;
  
  constructor(spawner, monitor, killer, persistence, notifier, widget, config);
  
  spawn(command: string, label: string): { job: Job; error?: string };
  kill(jobId: string): { success: boolean; message: string };
  list(): string;
  
  init(pi: ExtensionAPI, ctx: ExtensionContext): void;
  shutdown(): void;
}
```
- `spawn`: Validates command, checks concurrent limit, delegates to spawner + monitor, persists
- `kill`: Validates job exists and is running, delegates to killer
- `list`: Formats running/completed/failed jobs within TTL window
- `init`: Creates run dir, recovers from sidecar, starts widget refresh
- `shutdown`: Kills all running jobs, flushes notifications, stops widget, cleans logs

All dependencies injected via constructor. Default construction in `index.ts` creates real instances. Tests inject mocks.

## Types

```typescript
type JobStatus = "running" | "completed" | "failed" | "killed";

interface Job {
  id: string;
  label: string;
  command: string;
  logPath: string;
  pid: number;
  status: JobStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
}

interface BgRunConfig {
  maxConcurrentJobs: number;    // default: 10
  completedTtlMs: number;       // default: 300000 (5 min)
  widgetRefreshMs: number;      // default: 3000
  killTimeoutMs: number;        // default: 10000
  runDir: string;               // derived: /tmp/bg-run/<sessionId>
}
```

## Configuration

Users configure via Pi settings (`.pi/settings.json` or `~/.pi/agent/settings.json`):

```json
{
  "bgRun": {
    "maxConcurrentJobs": 10,
    "completedTtlMs": 300000,
    "widgetRefreshMs": 3000,
    "killTimeoutMs": 10000
  }
}
```

Loading flow:
1. `session_start` event fires
2. Read merged settings from context
3. Extract `bgRun` key, merge with defaults
4. Pass config to `new JobManager(..., config)`

Omitted keys use defaults. No env vars, no CLI flags. Pi settings is the single source of truth.

## Tool API

### bg_run
- **Parameters:** `{ command: string, label?: string }`
- **Returns:** `{ jobId, logPath }` in details, human-readable text in content
- **Errors:** Empty command, max concurrent reached, spawn failure, log file creation failure

### bg_list
- **Parameters:** `{}` (none)
- **Returns:** Formatted text with running/completed/failed sections
- **Filters:** Completed/failed jobs older than `completedTtlMs` are omitted from listing

### bg_kill
- **Parameters:** `{ job_id: string }`
- **Returns:** Success message with SIGTERM + SIGKILL timeout info
- **Errors:** Job not found, job not running

## Breaking Changes

1. **Job ID format:** `bg_<timestamp>_<random4>` → `bg_<random8>` (shorter, still unique)
2. **Notification format:** Improved message layout with job ID included
3. **Widget layout:** Braille spinner animation for running jobs (staggered per-job phase), adaptive refresh rate (500ms active / 3000ms idle)
4. **Display ID:** Now shows full ID instead of stripped prefix segment

## Notification Behavior

On job completion (exit, fail, or kill), the agent is automatically notified via `pi.sendMessage` with `triggerTurn: true`. This causes the agent to read the log and analyze results. Always-on, not configurable.

## Testing

### Unit Tests (Vitest + mocks)

| Test file | Mocks | Key assertions |
|---|---|---|
| `process-spawner.test.ts` | `child_process.spawn`, `fs.openSync` | Log file created, spawn detached, handle spawn error |
| `process-monitor.test.ts` | `process.kill(pid, 0)` | Poll detects exit, unwatch stops polling, ignore double-fire |
| `process-killer.test.ts` | `process.kill` | SIGTERM first, SIGKILL after timeout, skip SIGKILL if already dead |
| `persistence.test.ts` | `fs.readFileSync/writeFileSync` | Round-trip save/load, handle corrupted JSON, recover stale running jobs |
| `notifier.test.ts` | `pi.sendMessage` | Batch 2 jobs in 50ms, single job format, flush on shutdown |
| `job-manager.test.ts` | All core modules via DI | spawn delegates to spawner, onExit triggers persist+notify+widget |
| `config.test.ts` | Settings object | Merge defaults, override from settings, missing key = default |

### Integration Tests (real processes)

| Test file | Scenario |
|---|---|
| `spawn-complete.test.ts` | `sleep 1 && echo hello` → spawn → detect completion → notification sent |
| `kill-escalation.test.ts` | `sleep 60` → kill → SIGTERM → process dies (or SIGKILL if trapped) |
| `recovery.test.ts` | Spawn job → save sidecar → new JobManager → recover → job still tracked |
| `concurrent-jobs.test.ts` | Spawn N jobs up to max → reject N+1 → kill one → can spawn again |

## Package Publishing

```json
{
  "name": "pi-bg-run",
  "version": "1.0.0",
  "keywords": ["pi-package"],
  "main": "src/index.ts",
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  }
}
```

Install: `pi install npm:pi-bg-run`

No `build` step needed — Pi loads extensions via jiti (TypeScript directly).
