# pi-bg-run

Background process management for [Pi](https://pi.dev) coding agent.

Spawn long-running commands (ML training, builds, tests, experiments) and get automatically notified when they complete. Monitor jobs via widget, TUI panel, or tool calls.

## Install

```bash
pi install npm:pi-bg-run
```

## Tools

### `bg_run`

Run a shell command in the background.

**Parameters:**
- `command` (string, required) — Shell command to run
- `label` (string, optional) — Human-readable label

Returns job ID and log path. Agent is automatically notified on completion.

### `bg_list`

List all background jobs with status and elapsed time.

### `bg_kill`

Terminate a running job. Sends SIGTERM, escalates to SIGKILL after timeout.

**Parameters:**
- `job_id` (string, required) — Job ID to kill

## Interactive Panel

Press `/bg` in Pi TUI to open the interactive jobs panel:

- `↑/↓` — Navigate jobs
- `Enter` — View log tail
- `k` — Kill (press twice to confirm)
- `q` / `Esc` — Close panel

Running jobs show animated braille spinners (`⣾ ⣽ ⣻ ⢿ ⡿ ⣟ ⣯ ⣷`), staggered per job for visual variety.

## Configuration

Add to `.pi/settings.json` or `~/.pi/agent/settings.json`:

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

| Setting | Default | Description |
|---|---|---|
| `maxConcurrentJobs` | 10 | Maximum simultaneous background jobs |
| `completedTtlMs` | 300000 (5 min) | How long completed/failed jobs stay visible in list and widget |
| `widgetRefreshMs` | 3000 | Base widget refresh interval (auto-adapts to 500ms when jobs are running) |
| `killTimeoutMs` | 10000 (10s) | Time before SIGKILL escalation after SIGTERM |

## Architecture

```
src/
  index.ts           # Extension entry point
  types.ts           # Shared types
  config.ts          # Settings loader
  core/
    job-manager.ts   # Orchestrator (DI)
    process-spawner.ts
    process-monitor.ts
    process-killer.ts
    persistence.ts
  ui/
    notifier.ts      # Batched notifications
    widget.ts        # Braille spinner, adaptive refresh
    panel.ts         # TUI panel component
  tools/
    bg-run.ts
    bg-list.ts
    bg-kill.ts
```

## Development

```bash
npm install
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests only
npm run test:watch    # Watch mode
```

## License

MIT
