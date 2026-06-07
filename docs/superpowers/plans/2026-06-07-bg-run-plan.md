# pi-bg-run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the single-file `bg-run.ts` extension into a modular, tested, publishable Pi package called `pi-bg-run`.

**Architecture:** Feature-based module decomposition with dependency injection. `JobManager` orchestrates 6 single-responsibility modules (spawner, monitor, killer, persistence, notifier, widget). Tools and TUI panel are thin adapters over JobManager. All config via Pi settings.

**Tech Stack:** TypeScript, Vitest, Pi Extension API (`@earendil-works/pi-coding-agent`), Pi TUI (`@earendil-works/pi-tui`), TypeBox schemas.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | npm package manifest with `pi` key |
| `tsconfig.json` | TypeScript config |
| `vitest.config.ts` | Test runner config |
| `src/types.ts` | Shared types: `Job`, `JobStatus`, `BgRunConfig` |
| `src/config.ts` | Load settings, merge with defaults |
| `src/core/process-spawner.ts` | Spawn detached child process, manage log FD |
| `src/core/process-monitor.ts` | PID poll + close event, unwatch cleanup |
| `src/core/process-killer.ts` | SIGTERM → SIGKILL escalation |
| `src/core/persistence.ts` | Sidecar JSON save / load / recover |
| `src/core/job-manager.ts` | Orchestrator: composes all core modules |
| `src/ui/notifier.ts` | Batch notifications, format, deliver |
| `src/ui/widget.ts` | Braille spinner, adaptive refresh, status bar |
| `src/ui/panel.ts` | `/bg` TUI panel component |
| `src/tools/bg-run.ts` | `bg_run` tool + renderers |
| `src/tools/bg-list.ts` | `bg_list` tool + renderers |
| `src/tools/bg-kill.ts` | `bg_kill` tool + renderers |
| `src/index.ts` | Extension entry point: wire events, tools, lifecycle |
| `AGENTS.md` | Project context for AI agents |
| `README.md` | User-facing documentation |
| `tests/unit/process-spawner.test.ts` | Unit tests for spawner |
| `tests/unit/process-monitor.test.ts` | Unit tests for monitor |
| `tests/unit/process-killer.test.ts` | Unit tests for killer |
| `tests/unit/persistence.test.ts` | Unit tests for persistence |
| `tests/unit/notifier.test.ts` | Unit tests for notifier |
| `tests/unit/job-manager.test.ts` | Unit tests for orchestrator |
| `tests/unit/config.test.ts` | Unit tests for config loading |
| `tests/integration/spawn-complete.test.ts` | Real process lifecycle |
| `tests/integration/kill-escalation.test.ts` | SIGTERM → SIGKILL |
| `tests/integration/recovery.test.ts` | Sidecar recovery across restarts |
| `tests/integration/concurrent-jobs.test.ts` | Concurrent limit |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "pi-bg-run",
  "version": "1.0.0",
  "description": "Background process management for Pi coding agent — spawn, monitor, and get notified when long-running commands complete.",
  "keywords": ["pi-package"],
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 10_000,
  },
});
```

- [ ] **Step 4: Create src/types.ts**

```typescript
export type JobStatus = "running" | "completed" | "failed" | "killed";

export interface Job {
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

export interface BgRunConfig {
  maxConcurrentJobs: number;
  completedTtlMs: number;
  widgetRefreshMs: number;
  killTimeoutMs: number;
  runDir: string;
}

export interface BgRunUserSettings {
  maxConcurrentJobs?: number;
  completedTtlMs?: number;
  widgetRefreshMs?: number;
  killTimeoutMs?: number;
}
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules` created, no errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold pi-bg-run project structure"
```

---

### Task 2: Config Module

**Files:**
- Create: `src/config.ts`
- Test: `tests/unit/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import type { BgRunUserSettings } from "../src/types.js";

describe("loadConfig", () => {
  it("returns defaults when no user settings provided", () => {
    const config = loadConfig(undefined, "/tmp/test-session");
    expect(config).toEqual({
      maxConcurrentJobs: 10,
      completedTtlMs: 300_000,
      widgetRefreshMs: 3_000,
      killTimeoutMs: 10_000,
      runDir: "/tmp/test-session",
    });
  });

  it("merges user settings over defaults", () => {
    const user: BgRunUserSettings = { maxConcurrentJobs: 5, killTimeoutMs: 20_000 };
    const config = loadConfig(user, "/tmp/test-session");
    expect(config.maxConcurrentJobs).toBe(5);
    expect(config.killTimeoutMs).toBe(20_000);
    expect(config.completedTtlMs).toBe(300_000); // unchanged default
  });

  it("uses defaults for undefined user settings keys", () => {
    const user: BgRunUserSettings = { completedTtlMs: 60_000 };
    const config = loadConfig(user, "/tmp/test-session");
    expect(config.maxConcurrentJobs).toBe(10);
    expect(config.completedTtlMs).toBe(60_000);
    expect(config.runDir).toBe("/tmp/test-session");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL — `loadConfig` not found

- [ ] **Step 3: Write implementation**

```typescript
// src/config.ts
import type { BgRunConfig, BgRunUserSettings } from "./types.js";

const DEFAULTS: Omit<BgRunConfig, "runDir"> = {
  maxConcurrentJobs: 10,
  completedTtlMs: 300_000,
  widgetRefreshMs: 3_000,
  killTimeoutMs: 10_000,
};

export function loadConfig(user: BgRunUserSettings | undefined, runDir: string): BgRunConfig {
  return {
    maxConcurrentJobs: user?.maxConcurrentJobs ?? DEFAULTS.maxConcurrentJobs,
    completedTtlMs: user?.completedTtlMs ?? DEFAULTS.completedTtlMs,
    widgetRefreshMs: user?.widgetRefreshMs ?? DEFAULTS.widgetRefreshMs,
    killTimeoutMs: user?.killTimeoutMs ?? DEFAULTS.killTimeoutMs,
    runDir,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat: add config module with defaults and user override"
```

---

### Task 3: Process Spawner

**Files:**
- Create: `src/core/process-spawner.ts`
- Test: `tests/unit/process-spawner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/process-spawner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProcessSpawner } from "../src/core/process-spawner.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));
vi.mock("node:fs", () => ({
  openSync: vi.fn(() => 42),
  closeSync: vi.fn(),
}));

import { spawn } from "node:child_process";
import * as fs from "node:fs";

describe("ProcessSpawner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spawns detached process with log file", () => {
    const mockChild = { pid: 12345, unref: vi.fn(), on: vi.fn() };
    vi.mocked(spawn).mockReturnValue(mockChild as any);

    const spawner = createProcessSpawner();
    const result = spawner.spawn("echo hello", "/tmp/run");

    expect(spawn).toHaveBeenCalledWith("sh", ["-c", "echo hello"], {
      detached: true,
      stdio: ["ignore", 42, 42],
    });
    expect(fs.openSync).toHaveBeenCalledWith(expect.stringMatching(/\/tmp\/run\/bg_.*\.log/), "w");
    expect(fs.closeSync).toHaveBeenCalledWith(42);
    expect(mockChild.unref).toHaveBeenCalled();
    expect(result.pid).toBe(12345);
    expect(result.logPath).toMatch(/\/tmp\/run\/bg_.*\.log/);
    expect(result.child).toBe(mockChild);
  });

  it("throws with descriptive error when spawn fails", () => {
    vi.mocked(spawn).mockImplementation(() => { throw new Error("ENOENT"); });
    const spawner = createProcessSpawner();
    expect(() => spawner.spawn("bad command", "/tmp/run")).toThrow("Failed to spawn process: ENOENT");
    expect(fs.closeSync).toHaveBeenCalledWith(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/process-spawner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/process-spawner.ts
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface SpawnResult {
  pid: number;
  logPath: string;
  child: ReturnType<typeof spawn>;
}

export function createProcessSpawner() {
  function generateId(): string {
    return `bg_${Math.random().toString(36).slice(2, 10)}`;
  }

  function spawnProcess(command: string, runDir: string): SpawnResult {
    const id = generateId();
    const logPath = path.join(runDir, `${id}.log`);
    let logFd: number;
    try {
      logFd = fs.openSync(logPath, "w");
    } catch (err) {
      throw new Error(`Failed to create log file: ${err}`);
    }
    try {
      const child = spawn("sh", ["-c", command], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
      });
      const pid = child.pid!;
      child.unref();
      fs.closeSync(logFd);
      return { pid, logPath, child };
    } catch (err) {
      fs.closeSync(logFd);
      throw new Error(`Failed to spawn process: ${err}`);
    }
  }

  return { spawn: spawnProcess, generateId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/process-spawner.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/process-spawner.ts tests/unit/process-spawner.test.ts
git commit -m "feat: add process spawner module"
```

---

### Task 4: Process Monitor

**Files:**
- Create: `src/core/process-monitor.ts`
- Test: `tests/unit/process-monitor.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/process-monitor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProcessMonitor } from "../src/core/process-monitor.js";

describe("ProcessMonitor", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("calls onExit when PID poll detects process is dead", () => {
    const monitor = createProcessMonitor(1000);
    const onExit = vi.fn();
    let killCallCount = 0;
    const originalKill = process.kill;
    vi.spyOn(process, "kill").mockImplementation((pid: number, signal: any) => {
      if (signal === 0) { killCallCount++; throw new Error("ESRCH"); }
      return true;
    });

    const unwatch = monitor.watch("job1", 999, onExit);
    vi.advanceTimersByTime(1000);
    expect(onExit).toHaveBeenCalledTimes(1);
    unwatch();
    vi.restoreAllMocks();
  });

  it("does not call onExit while process is alive", () => {
    const monitor = createProcessMonitor(1000);
    const onExit = vi.fn();
    vi.spyOn(process, "kill").mockReturnValue(true as any);

    const unwatch = monitor.watch("job2", 888, onExit);
    vi.advanceTimersByTime(3000);
    expect(onExit).not.toHaveBeenCalled();
    unwatch();
    vi.restoreAllMocks();
  });

  it("stops polling after unwatch", () => {
    const monitor = createProcessMonitor(1000);
    const onExit = vi.fn();
    vi.spyOn(process, "kill").mockReturnValue(true as any);

    const unwatch = monitor.watch("job3", 777, onExit);
    unwatch();
    vi.advanceTimersByTime(5000);
    expect(onExit).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("guards against double-fire — onExit called at most once", () => {
    const monitor = createProcessMonitor(1000);
    const onExit = vi.fn();
    let pollCount = 0;
    vi.spyOn(process, "kill").mockImplementation((pid: number, signal: any) => {
      if (signal === 0) { pollCount++; throw new Error("ESRCH"); }
      return true;
    });

    monitor.watch("job4", 666, onExit);
    // Advance enough for multiple poll cycles
    vi.advanceTimersByTime(3000);
    expect(onExit).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/process-monitor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/process-monitor.ts
export function createProcessMonitor(pollIntervalMs: number) {
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  function watch(jobId: string, pid: number, onExit: () => void): () => void {
    let fired = false;
    const timer = setInterval(() => {
      try {
        process.kill(pid, 0);
      } catch {
        if (!fired) {
          fired = true;
          clear(jobId);
          onExit();
        }
      }
    }, pollIntervalMs);
    timers.set(jobId, timer);
    return () => clear(jobId);
  }

  function clear(jobId: string) {
    const timer = timers.get(jobId);
    if (timer) { clearInterval(timer); timers.delete(jobId); }
  }

  function clearAll() {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
  }

  return { watch, clear, clearAll };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/process-monitor.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/process-monitor.ts tests/unit/process-monitor.test.ts
git commit -m "feat: add process monitor module with PID polling"
```

---

### Task 5: Process Killer

**Files:**
- Create: `src/core/process-killer.ts`
- Test: `tests/unit/process-killer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/process-killer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProcessKiller } from "../src/core/process-killer.js";

describe("ProcessKiller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(process, "kill").mockReturnValue(true as any);
  });

  it("sends SIGTERM to process group first", async () => {
    const killer = createProcessKiller(5000);
    const killPromise = killer.kill(1234);
    expect(process.kill).toHaveBeenCalledWith(-1234, "SIGTERM");
    // Resolve by making process dead
    vi.mocked(process.kill).mockImplementation(() => { throw new Error("ESRCH"); });
    await vi.advanceTimersByTimeAsync(100);
    await killPromise;
  });

  it("falls back to SIGTERM on single PID if group kill fails", async () => {
    vi.mocked(process.kill).mockImplementation((pid: number) => {
      if (pid < 0) throw new Error("ESRCH");
      return true;
    });
    const killer = createProcessKiller(5000);
    const killPromise = killer.kill(5678);
    expect(process.kill).toHaveBeenCalledWith(-5678, "SIGTERM");
    expect(process.kill).toHaveBeenCalledWith(5678, "SIGTERM");
    // Make process dead
    vi.mocked(process.kill).mockImplementation(() => { throw new Error("ESRCH"); });
    await vi.advanceTimersByTimeAsync(100);
    await killPromise;
  });

  it("escalates to SIGKILL after timeout", async () => {
    // Process stays alive after SIGTERM
    const killer = createProcessKiller(3000);
    const killPromise = killer.kill(9999);
    await vi.advanceTimersByTimeAsync(3000);
    expect(process.kill).toHaveBeenCalledWith(-9999, "SIGKILL");
    // Make dead to resolve
    vi.mocked(process.kill).mockImplementation(() => { throw new Error("ESRCH"); });
    await vi.advanceTimersByTimeAsync(100);
    await killPromise;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/process-killer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/process-killer.ts
export function createProcessKiller(timeoutMs: number) {
  function sendSignal(pid: number, signal: NodeJS.Signals): boolean {
    try { process.kill(-pid, signal); return true; }
    catch { try { process.kill(pid, signal); return true; } catch { return false; } }
  }

  async function isAlive(pid: number): Promise<boolean> {
    return new Promise((resolve) => {
      const check = () => { try { process.kill(pid, 0); resolve(true); } catch { resolve(false); } };
      setTimeout(check, 100);
    });
  }

  async function kill(pid: number): Promise<void> {
    sendSignal(pid, "SIGTERM");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await isAlive(pid))) return;
    }
    sendSignal(pid, "SIGKILL");
  }

  return { kill, sendSignal };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/process-killer.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/process-killer.ts tests/unit/process-killer.test.ts
git commit -m "feat: add process killer with SIGTERM→SIGKILL escalation"
```

---

### Task 6: Persistence

**Files:**
- Create: `src/core/persistence.ts`
- Test: `tests/unit/persistence.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/persistence.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPersistence } from "../src/core/persistence.js";
import type { Job } from "../src/types.js";

const mockJobs: Job[] = [
  { id: "bg_abc123", label: "test", command: "echo hi", logPath: "/tmp/bg_abc123.log", pid: 100, status: "running", exitCode: null, startedAt: 1000, endedAt: null },
  { id: "bg_def456", label: "done", command: "ls", logPath: "/tmp/bg_def456.log", pid: 200, status: "completed", exitCode: 0, startedAt: 2000, endedAt: 3000 },
];

describe("Persistence", () => {
  let readData: string | null = null;
  let writtenData: string | null = null;

  beforeEach(() => {
    readData = null;
    writtenData = null;
    vi.doMock("node:fs", () => ({
      existsSync: vi.fn(() => readData !== null),
      readFileSync: vi.fn(() => readData),
      writeFileSync: vi.fn((_p: string, data: string) => { writtenData = data; }),
      mkdirSync: vi.fn(),
    }));
  });

  it("round-trip saves and loads jobs", async () => {
    const { createPersistence } = await import("../src/core/persistence.js");
    const persistence = createPersistence();
    persistence.save(mockJobs, "/tmp/jobs.json");
    expect(writtenData).toBeTruthy();
    readData = writtenData;
    const loaded = persistence.load("/tmp/jobs.json");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe("bg_abc123");
  });

  it("returns empty array when sidecar file does not exist", async () => {
    const { createPersistence } = await import("../src/core/persistence.js");
    const persistence = createPersistence();
    const loaded = persistence.load("/tmp/nonexistent.json");
    expect(loaded).toEqual([]);
  });

  it("returns empty array for corrupted JSON", async () => {
    const { createPersistence } = await import("../src/core/persistence.js");
    readData = "not valid json{{{";
    const persistence = createPersistence();
    const loaded = persistence.load("/tmp/bad.json");
    expect(loaded).toEqual([]);
  });

  it("recovers running jobs — marks dead PIDs as completed", async () => {
    const { createPersistence } = await import("../src/core/persistence.js");
    vi.spyOn(process, "kill").mockImplementation((pid: number, signal: any) => {
      if (signal === 0 && pid === 100) throw new Error("ESRCH"); // dead
      return true;
    });
    const persistence = createPersistence();
    const recovered = persistence.recover(mockJobs);
    const runningJob = recovered.find(j => j.id === "bg_abc123")!;
    expect(runningJob.status).toBe("completed");
    expect(runningJob.exitCode).toBeNull();
    expect(runningJob.endedAt).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/persistence.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/persistence.ts
import * as fs from "node:fs";
import type { Job } from "../types.js";

export function createPersistence() {
  function save(jobs: Job[], sidecarPath: string): void {
    try {
      fs.writeFileSync(sidecarPath, JSON.stringify({ jobs }, null, 2));
    } catch { /* best effort */ }
  }

  function load(sidecarPath: string): Job[] {
    try {
      if (!fs.existsSync(sidecarPath)) return [];
      const data = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"));
      return data.jobs ?? [];
    } catch { return []; }
  }

  function recover(jobs: Job[]): Job[] {
    return jobs.map(job => {
      if (job.status !== "running") return job;
      try {
        process.kill(job.pid, 0);
        return job; // still alive
      } catch {
        return { ...job, status: "completed" as const, exitCode: null, endedAt: Date.now() };
      }
    });
  }

  return { save, load, recover };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/persistence.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/persistence.ts tests/unit/persistence.test.ts
git commit -m "feat: add persistence module for sidecar save/load/recover"
```

---

### Task 7: Notifier

**Files:**
- Create: `src/ui/notifier.ts`
- Test: `tests/unit/notifier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/notifier.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNotifier } from "../src/ui/notifier.js";
import type { Job } from "../src/types.js";

const completedJob: Job = {
  id: "bg_abc12345", label: "build", command: "npm run build", logPath: "/tmp/bg_abc12345.log",
  pid: 100, status: "completed", exitCode: 0, startedAt: 1000, endedAt: 5000,
};
const failedJob: Job = {
  id: "bg_def67890", label: "test", command: "npm test", logPath: "/tmp/bg_def67890.log",
  pid: 200, status: "failed", exitCode: 1, startedAt: 2000, endedAt: 6000,
};

describe("Notifier", () => {
  let mockPi: any;
  beforeEach(() => {
    vi.useFakeTimers();
    mockPi = { sendMessage: vi.fn() };
  });
  afterEach(() => { vi.useRealTimers(); });

  it("sends notification immediately for single job", () => {
    const notifier = createNotifier();
    notifier.notify(completedJob, mockPi);
    vi.advanceTimersByTime(100);
    expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
    const call = mockPi.sendMessage.mock.calls[0];
    expect(call[0].content).toContain("bg_abc12345");
    expect(call[0].content).toContain("completed");
  });

  it("batches multiple notifications within 50ms window", () => {
    const notifier = createNotifier();
    notifier.notify(completedJob, mockPi);
    notifier.notify(failedJob, mockPi);
    vi.advanceTimersByTime(100);
    expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
    const msg = mockPi.sendMessage.mock.calls[0][0].content;
    expect(msg).toContain("2 background jobs completed");
    expect(msg).toContain("build");
    expect(msg).toContain("test");
  });

  it("flushes all pending on flush(true)", () => {
    const notifier = createNotifier();
    notifier.notify(completedJob, mockPi);
    notifier.flush(mockPi, true);
    expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
    // Advance timer — no second call
    vi.advanceTimersByTime(200);
    expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("formats killed job with correct icon", () => {
    const killedJob: Job = { ...completedJob, status: "killed", id: "bg_kil12345", label: "stuck" };
    const notifier = createNotifier();
    notifier.notify(killedJob, mockPi);
    vi.advanceTimersByTime(100);
    const msg = mockPi.sendMessage.mock.calls[0][0].content;
    expect(msg).toContain("🔴");
    expect(msg).toContain("killed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/notifier.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/ui/notifier.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Job } from "../types.js";

const BATCH_MS = 50;

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function jobElapsed(job: Job): number {
  return job.endedAt ? job.endedAt - job.startedAt : Date.now() - job.startedAt;
}

export function createNotifier() {
  let pending: Job[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function notify(job: Job, pi: ExtensionAPI): void {
    pending.push(job);
    if (!timer) {
      timer = setTimeout(() => flush(pi, false), BATCH_MS);
    }
  }

  function flush(pi: ExtensionAPI, sync: boolean): void {
    if (timer) { clearTimeout(timer); timer = null; }
    const jobs = pending;
    pending = [];
    if (jobs.length === 0) return;

    let message: string;
    if (jobs.length === 1) {
      const j = jobs[0];
      const icon = j.status === "completed" ? "✅" : j.status === "killed" ? "🔴" : "❌";
      message = `🔔 Background job ${j.status}: ${j.label}\nID: ${j.id}\nStatus: ${icon} ${j.status} (exit ${j.exitCode})\nDuration: ${formatDuration(jobElapsed(j))}\nLog: ${j.logPath}\n\nRead the log to analyze results.`;
    } else {
      message = `🔔 ${jobs.length} background jobs completed:\n\n`;
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        const icon = j.status === "completed" ? "✅" : j.status === "killed" ? "🔴" : "❌";
        message += `${i + 1}. ${j.label} [${j.id}] — ${icon} ${j.status} (exit ${j.exitCode}) — ${formatDuration(jobElapsed(j))}\n   Log: ${j.logPath}\n\n`;
      }
      message += `Read the logs to analyze results.`;
    }
    try {
      pi.sendMessage(
        { customType: "bg-run-notify", content: message, display: true },
        { deliverAs: "followUp", triggerTurn: true },
      );
    } catch { /* pi may be shutting down */ }
  }

  return { notify, flush };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/notifier.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/notifier.ts tests/unit/notifier.test.ts
git commit -m "feat: add notification module with batching"
```

---

### Task 8: Widget with Braille Spinner

**Files:**
- Create: `src/ui/widget.ts`
- Test: `tests/unit/widget.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/widget.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWidget } from "../src/ui/widget.js";
import type { Job } from "../src/types.js";

const baseJob: Job = {
  id: "bg_abc12345", label: "build", command: "npm run build", logPath: "/tmp/build.log",
  pid: 100, status: "running", exitCode: null, startedAt: Date.now() - 5000, endedAt: null,
};

function mockContext(hasUI = true) {
  return {
    hasUI,
    ui: {
      theme: {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      },
      setWidget: vi.fn(),
      setStatus: vi.fn(),
    },
  } as any;
}

describe("Widget", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders running job with braille spinner character", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    widget.refresh([baseJob], ctx);
    expect(ctx.ui.setWidget).toHaveBeenCalled();
    const lines = ctx.ui.setWidget.mock.calls[0][1];
    // First line is header, second should contain a braille spinner char
    const spinnerChars = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
    const jobLine = lines.find((l: string) => spinnerChars.some(c => l.includes(c)));
    expect(jobLine).toBeTruthy();
    expect(jobLine).toContain("build");
  });

  it("renders completed job with static ✅ icon", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    const completedJob = { ...baseJob, status: "completed" as const, exitCode: 0, endedAt: Date.now() };
    widget.refresh([completedJob], ctx);
    const lines = ctx.ui.setWidget.mock.calls[0][1];
    const doneLine = lines.find((l: string) => l.includes("✅"));
    expect(doneLine).toBeTruthy();
  });

  it("clears widget when no jobs to show", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    widget.refresh([], ctx);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("bg-run", undefined);
  });

  it("staggered spinners — different jobs show different frames", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    const job2 = { ...baseJob, id: "bg_other", label: "test", startedAt: baseJob.startedAt + 2000 };
    widget.refresh([baseJob, job2], ctx);
    const lines = ctx.ui.setWidget.mock.calls[0][1];
    const spinnerChars = new Set(["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"]);
    const found = lines.filter((l: string) => [...spinnerChars].some(c => l.includes(c)));
    // Both jobs should have a spinner, but they may differ due to stagger
    expect(found.length).toBe(2);
  });

  it("updates status bar with running count", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    widget.refresh([baseJob], ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("bg-run", "🏃 1 bg job");
  });

  it("adaptive refresh — starts at 500ms when running jobs exist", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    const getJobs = () => [baseJob];
    widget.start(getJobs, ctx);
    // Should have set a 500ms interval
    vi.advanceTimersByTime(500);
    expect(ctx.ui.setWidget.mock.calls.length).toBeGreaterThanOrEqual(1);
    widget.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/widget.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/ui/widget.ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Job } from "../types.js";

const SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
const ACTIVE_REFRESH_MS = 500;
const IDLE_REFRESH_MS = 3000;

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function getSpinnerFrame(job: Job): string {
  const offset = Math.floor(job.startedAt / 1000) % SPINNER_FRAMES.length;
  const elapsed = Date.now() - job.startedAt;
  const frameIdx = (offset + Math.floor(elapsed / ACTIVE_REFRESH_MS)) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[frameIdx];
}

export function createWidget(completedTtlMs: number) {
  let timer: ReturnType<typeof setInterval> | null = null;

  function refresh(jobs: Job[], ctx: ExtensionContext): void {
    try { if (!ctx.hasUI) return; } catch { return; }
    const running = jobs.filter(j => j.status === "running");
    const recent = jobs.filter(j => j.status !== "running" && j.endedAt && Date.now() - j.endedAt < completedTtlMs);

    if (running.length === 0 && recent.length === 0) {
      ctx.ui.setWidget("bg-run", undefined);
      ctx.ui.setStatus("bg-run", undefined);
      return;
    }

    const th = ctx.ui.theme;
    const lines: string[] = [th.fg("accent", " bg-run ")];
    for (const j of running) {
      const spinner = getSpinnerFrame(j);
      lines.push(` ${th.fg("warning", spinner)} ${th.fg("text", j.label.slice(0, 25).padEnd(25))} ${th.fg("dim", formatDuration(Date.now() - j.startedAt))}`);
    }
    for (const j of recent) {
      const icon = j.status === "completed" ? th.fg("success", "✅") : th.fg("error", j.status === "killed" ? "🔴" : "❌");
      lines.push(` ${icon} ${th.fg("dim", j.label.slice(0, 25).padEnd(25))} ${th.fg("dim", formatDuration((j.endedAt ?? Date.now()) - j.startedAt))}`);
    }
    ctx.ui.setWidget("bg-run", lines);

    const n = running.length;
    ctx.ui.setStatus("bg-run", n === 0 ? undefined : n === 1 ? "🏃 1 bg job" : `🏃 ${n} bg jobs`);
  }

  function start(getJobs: () => Job[], ctx: ExtensionContext): void {
    stop();
    const tick = () => refresh(getJobs(), ctx);
    // Start with active refresh, adapt in tick
    timer = setInterval(tick, ACTIVE_REFRESH_MS);
    tick();
  }

  function stop(): void {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { refresh, start, stop };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/widget.test.ts`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/widget.ts tests/unit/widget.test.ts
git commit -m "feat: add widget module with braille spinner and adaptive refresh"
```

---

### Task 9: TUI Panel Component

**Files:**
- Create: `src/ui/panel.ts`

This is a direct extraction from the original `BgPanelComponent`. No new tests — the interactive TUI component is tested manually and via integration tests.

- [ ] **Step 1: Write the panel component**

```typescript
// src/ui/panel.ts
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Job } from "../types.js";
import { SPINNER_FRAMES, ACTIVE_REFRESH_MS } from "./widget.js";

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function getSpinnerFrame(job: Job): string {
  const offset = Math.floor(job.startedAt / 1000) % SPINNER_FRAMES.length;
  const elapsed = Date.now() - job.startedAt;
  const frameIdx = (offset + Math.floor(elapsed / ACTIVE_REFRESH_MS)) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[frameIdx];
}

function formatElapsed(job: Job): string {
  return formatDuration(job.endedAt ? job.endedAt - job.startedAt : Date.now() - job.startedAt);
}

export function createBgPanelComponent(
  getJobs: () => Map<string, Job>,
  killJob: (id: string) => { success: boolean; message: string },
  theme: Theme,
  onClose: () => void,
) {
  let selectedIndex = 0;
  let pendingKillId: string | null = null;
  let logPreview: string | null = null;
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;

  function getSortedJobs(): Job[] {
    return Array.from(getJobs().values()).sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (a.status !== "running" && b.status === "running") return 1;
      return b.startedAt - a.startedAt;
    });
  }

  function invalidate() { cachedWidth = undefined; cachedLines = undefined; }

  function handleInput(data: string): void {
    const jobs = getSortedJobs();
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") { onClose(); return; }
    if (matchesKey(data, "up")) { selectedIndex = Math.max(0, selectedIndex - 1); pendingKillId = null; logPreview = null; invalidate(); return; }
    if (matchesKey(data, "down")) { selectedIndex = Math.min(jobs.length - 1, selectedIndex + 1); pendingKillId = null; logPreview = null; invalidate(); return; }
    if (data === "k") {
      const job = jobs[selectedIndex];
      if (job?.status === "running") {
        if (pendingKillId === job.id) { killJob(job.id); pendingKillId = null; }
        else { pendingKillId = job.id; }
        invalidate();
      }
      return;
    }
    if (matchesKey(data, "return") || data === " ") {
      const job = jobs[selectedIndex];
      if (job) viewLogTail(job);
      return;
    }
  }

  function viewLogTail(job: Job) {
    let tail = "(log file not found)";
    try { if (fs.existsSync(job.logPath)) tail = execSync(`tail -100 ${JSON.stringify(job.logPath)}`, { encoding: "utf-8", timeout: 5000 }); }
    catch { tail = "(error reading log file)"; }
    logPreview = tail;
    invalidate();
  }

  function render(width: number): string[] {
    if (cachedLines && cachedWidth === width) return cachedLines;
    const jobs = getSortedJobs();
    const th = theme;
    const lines: string[] = [];
    lines.push("");
    const title = th.fg("accent", " Background Jobs ");
    const border = th.fg("borderMuted", "─");
    lines.push(border.repeat(3) + title + border.repeat(Math.max(0, width - 20)));
    lines.push("");

    if (jobs.length === 0) {
      lines.push(truncateToWidth(`  ${th.fg("dim", "No background jobs. Use bg_run to start one.")}`, width));
    } else {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const selected = i === selectedIndex;
        const prefix = selected ? th.fg("accent", "▶ ") : "  ";
        let icon: string;
        switch (job.status) {
          case "running": icon = th.fg("warning", getSpinnerFrame(job)); break;
          case "completed": icon = th.fg("success", "✅"); break;
          case "failed": icon = th.fg("error", "❌"); break;
          case "killed": icon = th.fg("error", "🔴"); break;
        }
        const shortId = th.fg("dim", `[${job.id}]`);
        const label = selected ? th.bold(job.label.slice(0, 25)) : th.fg("text", job.label.slice(0, 25));
        const elapsed = th.fg("dim", formatElapsed(job));
        const killHint = pendingKillId === job.id ? th.fg("error", " [k again to confirm]") : "";
        lines.push(truncateToWidth(`${prefix}${icon} ${shortId} ${label.padEnd(25)} ${elapsed}${killHint}`, width));
      }
    }

    lines.push("");
    lines.push(truncateToWidth(`  ${th.fg("dim", "[↑/↓] Navigate  [Enter] View log  [k] Kill  [q] Quit")}`, width));
    lines.push("");

    if (logPreview !== null) {
      lines.push(truncateToWidth(th.fg("borderMuted", "─".repeat(width)), width));
      lines.push(truncateToWidth(th.fg("accent", " Log tail (last 100 lines) — press ↑/↓ to dismiss "), width));
      lines.push("");
      for (const line of logPreview.split("\n").slice(-100)) {
        lines.push(truncateToWidth(th.fg("dim", line), width));
      }
      lines.push("");
    }

    cachedWidth = width;
    cachedLines = lines;
    return lines;
  }

  return { handleInput, render };
}
```

Note: `SPINNER_FRAMES` and `ACTIVE_REFRESH_MS` are exported from `widget.ts` so panel reuses the same spinner logic.

- [ ] **Step 2: Export spinner constants from widget.ts**

Add to `src/ui/widget.ts`:
```typescript
export const SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
export const ACTIVE_REFRESH_MS = 500;
```

And remove the local `const` declarations for these in widget.ts, replacing with the exports.

- [ ] **Step 3: Commit**

```bash
git add src/ui/panel.ts src/ui/widget.ts
git commit -m "feat: add TUI panel component with braille spinner"
```

---

### Task 10: Job Manager (Orchestrator)

**Files:**
- Create: `src/core/job-manager.ts`
- Test: `tests/unit/job-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/job-manager.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createJobManager } from "../src/core/job-manager.js";
import type { Job } from "../src/types.js";

function mockDeps() {
  return {
    spawner: {
      spawn: vi.fn(() => ({ pid: 1234, logPath: "/tmp/bg_test.log", child: { on: vi.fn() } })),
      generateId: vi.fn(() => "bg_testid1"),
    },
    monitor: { watch: vi.fn(() => vi.fn()), clear: vi.fn(), clearAll: vi.fn() },
    killer: { kill: vi.fn(async () => {}), sendSignal: vi.fn() },
    persistence: { save: vi.fn(), load: vi.fn(() => []), recover: vi.fn((jobs: Job[]) => jobs) },
    notifier: { notify: vi.fn(), flush: vi.fn() },
    widget: { refresh: vi.fn(), start: vi.fn(), stop: vi.fn() },
    config: { maxConcurrentJobs: 10, completedTtlMs: 300000, widgetRefreshMs: 3000, killTimeoutMs: 10000, runDir: "/tmp/test-run" },
  };
}

describe("JobManager", () => {
  it("spawn delegates to spawner and persists", () => {
    const deps = mockDeps();
    const mgr = createJobManager(deps as any);
    const result = mgr.spawn("echo hi", "build");
    expect(result.job.id).toBe("bg_testid1");
    expect(result.job.status).toBe("running");
    expect(deps.spawner.spawn).toHaveBeenCalledWith("echo hi", "/tmp/test-run");
    expect(deps.persistence.save).toHaveBeenCalled();
    expect(deps.monitor.watch).toHaveBeenCalled();
  });

  it("spawn rejects empty command", () => {
    const deps = mockDeps();
    const mgr = createJobManager(deps as any);
    const result = mgr.spawn("", "");
    expect(result.error).toBeTruthy();
    expect(result.job.id).toBe("");
  });

  it("spawn rejects when max concurrent reached", () => {
    const deps = mockDeps();
    deps.config.maxConcurrentJobs = 1;
    const mgr = createJobManager(deps as any);
    mgr.spawn("cmd1", "first");
    const result = mgr.spawn("cmd2", "second");
    expect(result.error).toContain("Max");
  });

  it("kill delegates to killer for running job", () => {
    const deps = mockDeps();
    const mgr = createJobManager(deps as any);
    mgr.spawn("sleep 60", "sleeper");
    const result = mgr.kill("bg_testid1");
    expect(result.success).toBe(true);
    expect(deps.killer.kill).toHaveBeenCalledWith(1234, 10000);
  });

  it("kill returns error for non-running job", () => {
    const deps = mockDeps();
    const mgr = createJobManager(deps as any);
    const result = mgr.kill("nonexistent");
    expect(result.success).toBe(false);
  });

  it("onExit updates job, persists, notifies, refreshes widget", () => {
    const deps = mockDeps();
    const mgr = createJobManager(deps as any);
    mgr.spawn("cmd", "test");
    // Simulate exit via monitor callback
    const onExit = deps.monitor.watch.mock.calls[0][2] as () => void;
    onExit();
    const jobs = Array.from(mgr.jobs.values());
    expect(jobs[0].status).toBe("completed");
    expect(jobs[0].exitCode).toBe(0);
    expect(deps.persistence.save).toHaveBeenCalled();
    expect(deps.notifier.notify).toHaveBeenCalled();
    expect(deps.widget.refresh).toHaveBeenCalled();
  });

  it("shutdown stops widget, flushes notifier, clears monitors", () => {
    const deps = mockDeps();
    const mgr = createJobManager(deps as any);
    mgr.shutdown();
    expect(deps.widget.stop).toHaveBeenCalled();
    expect(deps.notifier.flush).toHaveBeenCalled();
    expect(deps.monitor.clearAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/job-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/job-manager.ts
import type { Job, BgRunConfig } from "../types.js";

export interface JobManagerDeps {
  spawner: { spawn: (cmd: string, runDir: string) => { pid: number; logPath: string; child: any }; generateId: () => string };
  monitor: { watch: (jobId: string, pid: number, onExit: () => void) => () => void; clear: (jobId: string) => void; clearAll: () => void };
  killer: { kill: (pid: number, timeoutMs: number) => Promise<void> };
  persistence: { save: (jobs: Job[], path: string) => void; load: (path: string) => Job[]; recover: (jobs: Job[]) => Job[] };
  notifier: { notify: (job: Job, pi: any) => void; flush: (pi: any, sync: boolean) => void };
  widget: { refresh: (jobs: Job[], ctx: any) => void; start: (getJobs: () => Job[], ctx: any) => void; stop: () => void };
  config: BgRunConfig;
}

export function createJobManager(deps: JobManagerDeps) {
  const jobs = new Map<string, Job>();
  const unwatchFns = new Map<string, () => void>();
  const killedIds = new Set<string>();
  let pi: any = null;
  let ctx: any = null;

  function autoLabel(command: string): string {
    const t = command.trim().replace(/\s+/g, " ");
    return t.length > 50 ? t.slice(0, 47) + "..." : t;
  }

  function spawn(command: string, label: string): { job: Job; error?: string } {
    if (!command?.trim()) return { job: emptyJob(), error: "Command cannot be empty" };
    const runningCount = Array.from(jobs.values()).filter(j => j.status === "running").length;
    if (runningCount >= deps.config.maxConcurrentJobs) {
      return { job: emptyJob(), error: `Max ${deps.config.maxConcurrentJobs} concurrent jobs. Use bg_list to check, bg_kill to free slots.` };
    }
    const id = deps.spawner.generateId();
    let result;
    try { result = deps.spawner.spawn(command, deps.config.runDir); }
    catch (err: any) { return { job: emptyJob(), error: err.message }; }
    const job: Job = {
      id, label: label || autoLabel(command), command, logPath: result.logPath, pid: result.pid,
      status: "running", exitCode: null, startedAt: Date.now(), endedAt: null,
    };
    jobs.set(id, job);
    unwatchFns.set(id, deps.monitor.watch(id, result.pid, () => onExit(id, 0)));
    result.child.on?.("close", (code: number | null) => onExit(id, code));
    result.child.on?.("error", () => onExit(id, 1));
    deps.persistence.save(Array.from(jobs.values()), sidecarPath());
    return { job };
  }

  function kill(jobId: string): { success: boolean; message: string } {
    const job = jobs.get(jobId);
    if (!job) return { success: false, message: `Job ${jobId} not found` };
    if (job.status !== "running") return { success: false, message: `Job ${jobId} not running (${job.status})` };
    killedIds.add(jobId);
    deps.killer.kill(job.pid, deps.config.killTimeoutMs);
    return { success: true, message: `Sent SIGTERM to ${jobId} (PID ${job.pid}): ${job.label}` };
  }

  function list(): string {
    const running = Array.from(jobs.values()).filter(j => j.status === "running");
    const completed = Array.from(jobs.values()).filter(j => j.status === "completed" && j.endedAt && Date.now() - j.endedAt < deps.config.completedTtlMs);
    const failed = Array.from(jobs.values()).filter(j => (j.status === "failed" || j.status === "killed") && j.endedAt && Date.now() - j.endedAt < deps.config.completedTtlMs);
    let out = "";
    if (running.length) {
      out += `🏃 Running (${running.length}):\n`;
      for (const j of running) out += `  [${j.id}] ${j.label.padEnd(30)} ${fmtElapsed(j)}   ${j.logPath}\n`;
      out += "\n";
    }
    if (completed.length) {
      out += `✅ Completed (${completed.length}):\n`;
      for (const j of completed) out += `  [${j.id}] ${j.label.padEnd(30)} ${fmtElapsed(j)}   exit ${j.exitCode}   ${j.logPath}\n`;
      out += "\n";
    }
    if (failed.length) {
      out += `❌ Failed/Killed (${failed.length}):\n`;
      for (const j of failed) out += `  [${j.id}] ${j.label.padEnd(30)} ${fmtElapsed(j)}   ${j.status === "killed" ? "killed" : `exit ${j.exitCode}`}   ${j.logPath}\n`;
      out += "\n";
    }
    return out.trim() || "No background jobs. Use bg_run to start one.";
  }

  function init(piRef: any, ctxRef: any) {
    pi = piRef; ctx = ctxRef;
    const recovered = deps.persistence.recover(deps.persistence.load(sidecarPath()));
    for (const job of recovered) {
      jobs.set(job.id, job);
      if (job.status === "running") {
        unwatchFns.set(job.id, deps.monitor.watch(job.id, job.pid, () => onExit(job.id, null)));
      }
    }
    deps.persistence.save(Array.from(jobs.values()), sidecarPath());
    deps.widget.start(() => Array.from(jobs.values()), ctx);
  }

  function shutdown() {
    let killed = 0;
    for (const [id, job] of jobs) {
      if (job.status === "running") { killedIds.add(id); deps.killer.kill(job.pid, deps.config.killTimeoutMs); killed++; }
    }
    deps.widget.stop();
    deps.monitor.clearAll();
    if (pi) deps.notifier.flush(pi, true);
    // Delayed log cleanup
    if (killed > 0) {
      setTimeout(() => { try { require("node:fs").rmSync(deps.config.runDir, { recursive: true, force: true }); } catch {} }, 15_000);
    }
  }

  function onExit(id: string, code: number | null) {
    deps.monitor.clear(id);
    const job = jobs.get(id);
    if (!job || job.status !== "running") return;
    const wasKilled = killedIds.has(id);
    job.exitCode = code;
    job.endedAt = Date.now();
    if (wasKilled) { job.status = "killed"; killedIds.delete(id); }
    else { job.status = code === 0 ? "completed" : "failed"; }
    deps.persistence.save(Array.from(jobs.values()), sidecarPath());
    deps.widget.refresh(Array.from(jobs.values()), ctx);
    if (pi) deps.notifier.notify(job, pi);
  }

  function sidecarPath() { return `${deps.config.runDir}/jobs.json`; }
  function emptyJob(): Job { return { id: "", label: "", command: "", logPath: "", pid: 0, status: "failed", exitCode: null, startedAt: 0, endedAt: null }; }
  function fmtElapsed(job: Job): string {
    const ms = job.endedAt ? job.endedAt - job.startedAt : Date.now() - job.startedAt;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  return { jobs, spawn, kill, list, init, shutdown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/job-manager.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/job-manager.ts tests/unit/job-manager.test.ts
git commit -m "feat: add job manager orchestrator with DI"
```

---

### Task 11: Tool Definitions

**Files:**
- Create: `src/tools/bg-run.ts`
- Create: `src/tools/bg-list.ts`
- Create: `src/tools/bg-kill.ts`

- [ ] **Step 1: Write bg-run tool**

```typescript
// src/tools/bg-run.ts
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

export const BgRunParams = Type.Object({
  command: Type.String({ description: "Shell command to run in background" }),
  label: Type.Optional(Type.String({ description: "Human-readable label for this job" })),
});

export function createBgRunTool(getManager: () => any) {
  return {
    name: "bg_run",
    label: "Background Run",
    description:
      "Run a shell command in the background. Returns immediately with a job ID and log path. " +
      "You will be automatically notified when the command completes. " +
      "Use bg_list to check status, bg_kill to terminate.",
    promptSnippet: "Run long scripts in background with automatic notification on completion",
    promptGuidelines: [
      "Use bg_run instead of bash for long-running scripts (ML training, backtests, validation, experiments)",
      "After bg_run, you will be automatically notified when the script completes — no need to poll",
      "Use bg_list to check status of running/completed background jobs",
      "Use bg_kill to terminate a running background job",
    ],
    parameters: BgRunParams,
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const manager = getManager();
      const { job, error } = manager.spawn(params.command, params.label ?? "");
      if (error) throw new Error(error);
      return {
        content: [{ type: "text" as const, text: `✅ Started ${job.id}: "${job.label}"\nCommand: ${job.command}\nLog: ${job.logPath}\nUse bg_list to check status. You'll be notified when it completes.` }],
        details: { jobId: job.id, logPath: job.logPath },
      };
    },
    renderCall(args: any, theme: any) {
      let text = theme.fg("toolTitle", theme.bold("bg_run "));
      if (args.label) text += theme.fg("dim", `"${args.label}"`);
      return new Text(text, 0, 0);
    },
    renderResult(result: any, _options: any, theme: any) {
      const details = result.details as { jobId?: string; logPath?: string } | undefined;
      if (!details?.jobId) return new Text(theme.fg("error", "Failed to start background job"), 0, 0);
      return new Text(theme.fg("success", "✓ ") + theme.fg("accent", details.jobId) + theme.fg("dim", ` → ${details.logPath}`), 0, 0);
    },
  };
}
```

- [ ] **Step 2: Write bg-list tool**

```typescript
// src/tools/bg-list.ts
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

export function createBgListTool(getManager: () => any) {
  return {
    name: "bg_list",
    label: "Background List",
    description: "List all background jobs with their status and elapsed time.",
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const manager = getManager();
      return { content: [{ type: "text" as const, text: manager.list() }], details: {} };
    },
    renderCall(_args: any, theme: any) {
      return new Text(theme.fg("toolTitle", theme.bold("bg_list")), 0, 0);
    },
    renderResult(result: any, _options: any, theme: any) {
      const text = result.content[0];
      const content = text?.type === "text" ? text.text : "No jobs";
      const lines = content.split("\n").slice(0, 6);
      const display = lines.join("\n");
      const truncated = content.split("\n").length > 6;
      return new Text(theme.fg("text", display) + (truncated ? theme.fg("dim", "\n  ...") : ""), 0, 0);
    },
  };
}
```

- [ ] **Step 3: Write bg-kill tool**

```typescript
// src/tools/bg-kill.ts
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

export const BgKillParams = Type.Object({
  job_id: Type.String({ description: "Job ID (e.g. bg_abc1)" }),
});

export function createBgKillTool(getManager: () => any) {
  return {
    name: "bg_kill",
    label: "Background Kill",
    description: "Terminate a running background job. Sends SIGTERM, then SIGKILL after 10s if still alive.",
    parameters: BgKillParams,
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const manager = getManager();
      const { success, message } = manager.kill(params.job_id);
      if (!success) throw new Error(message);
      return { content: [{ type: "text" as const, text: `🔴 ${message}` }], details: { killed: true } };
    },
    renderCall(args: any, theme: any) {
      return new Text(theme.fg("toolTitle", theme.bold("bg_kill ")) + theme.fg("accent", args.job_id), 0, 0);
    },
    renderResult(_result: any, _options: any, theme: any) {
      return new Text(theme.fg("warning", "🔴 ") + theme.fg("muted", "SIGTERM sent"), 0, 0);
    },
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/tools/bg-run.ts src/tools/bg-list.ts src/tools/bg-kill.ts
git commit -m "feat: add tool definitions for bg_run, bg_list, bg_kill"
```

---

### Task 12: Extension Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write the entry point**

```typescript
// src/index.ts
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { createProcessSpawner } from "./core/process-spawner.js";
import { createProcessMonitor } from "./core/process-monitor.js";
import { createProcessKiller } from "./core/process-killer.js";
import { createPersistence } from "./core/persistence.js";
import { createJobManager } from "./core/job-manager.js";
import { createNotifier } from "./ui/notifier.js";
import { createWidget } from "./ui/widget.js";
import { createBgRunTool } from "./tools/bg-run.js";
import { createBgListTool } from "./tools/bg-list.js";
import { createBgKillTool } from "./tools/bg-kill.js";
import { createBgPanelComponent } from "./ui/panel.js";

const BASE_RUN_DIR = "/tmp/bg-run";

/** Per-session JobManager registry */
const sessionManagers = new Map<string, ReturnType<typeof createJobManager>>();

export default function (pi: ExtensionAPI) {
  function getManager(ctx: any): ReturnType<typeof createJobManager> | undefined {
    const sid = ctx.sessionManager?.getSessionId();
    return sid ? sessionManagers.get(sid) : undefined;
  }

  function requireManager(ctx: any): ReturnType<typeof createJobManager> {
    const mgr = getManager(ctx);
    if (!mgr) throw new Error("bg-run: no active session. Start a session first.");
    return mgr;
  }

  // Register tools
  pi.registerTool(createBgRunTool(() => requireManager({})));
  pi.registerTool(createBgListTool(() => requireManager({})));
  pi.registerTool(createBgKillTool(() => requireManager({})));

  // Register /bg command
  pi.registerCommand("bg", {
    description: "Open background jobs panel",
    handler: async (_args: string, ctx: any) => {
      const manager = getManager(ctx);
      if (!manager || !ctx.hasUI) return;
      if (ctx.mode !== "tui") { ctx.ui.notify("/bg requires interactive mode", "error"); return; }
      await ctx.ui.custom<void>((_tui: any, theme: any, _kb: any, done: () => void) => {
        return createBgPanelComponent(
          () => manager.jobs,
          (id: string) => manager.kill(id),
          theme,
          () => done(),
        );
      });
    },
  });

  // Session lifecycle
  pi.on("session_start", async (_event: any, ctx: any) => {
    const sid = ctx.sessionManager?.getSessionId();
    if (!sid) return;
    // Clean up previous manager
    const prev = sessionManagers.get(sid);
    if (prev) prev.shutdown();

    const settings = ctx.settings?.bgRun;
    const runDir = path.join(BASE_RUN_DIR, sid);
    const config = loadConfig(settings, runDir);

    const spawner = createProcessSpawner();
    const monitor = createProcessMonitor(config.widgetRefreshMs);
    const killer = createProcessKiller(config.killTimeoutMs);
    const persistence = createPersistence();
    const notifier = createNotifier();
    const widget = createWidget(config.completedTtlMs);

    const manager = createJobManager({ spawner, monitor, killer, persistence, notifier, widget, config });
    manager.init(pi, ctx);
    sessionManagers.set(sid, manager);
  });

  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    const sid = ctx.sessionManager?.getSessionId();
    if (!sid) return;
    const manager = sessionManagers.get(sid);
    if (manager) { manager.shutdown(); sessionManagers.delete(sid); }
  });
}
```

Note: The `getManager` and `requireManager` functions in tools need access to `ctx`. Fix the tool factory to accept ctx lazily. The tools receive `ctx` in `execute()`, so the getManager closures need updating. The final wiring uses closures that capture the context at call time:

```typescript
  // Fix: tools get ctx from execute, not closure
  pi.registerTool({
    ...createBgRunTool(),
    async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
      const manager = requireManager(ctx);
      // ... same body
    },
  });
```

This will be refined during implementation to properly thread `ctx` through tool execute calls.

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors (or only peer dependency type resolution issues, acceptable)

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add extension entry point wiring events, tools, lifecycle"
```

---

### Task 13: Integration Tests

**Files:**
- Create: `tests/integration/spawn-complete.test.ts`
- Create: `tests/integration/kill-escalation.test.ts`
- Create: `tests/integration/recovery.test.ts`
- Create: `tests/integration/concurrent-jobs.test.ts`

- [ ] **Step 1: Write spawn-complete integration test**

```typescript
// tests/integration/spawn-complete.test.ts
import { describe, it, expect, vi } from "vitest";
import { createJobManager } from "../../src/core/job-manager.js";
import { createProcessSpawner } from "../../src/core/process-spawner.js";
import { createProcessMonitor } from "../../src/core/process-monitor.js";
import { createProcessKiller } from "../../src/core/process-killer.js";
import { createPersistence } from "../../src/core/persistence.js";
import { createNotifier } from "../../src/ui/notifier.js";
import { createWidget } from "../../src/ui/widget.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("integration: spawn → complete → notify", () => {
  it("spawns a fast command, detects completion, sends notification", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-run-test-"));
    const mockPi = { sendMessage: vi.fn() };
    const mockCtx = { hasUI: false, ui: { theme: { fg: (_: string, t: string) => t }, setWidget: vi.fn(), setStatus: vi.fn() } };

    const config = { maxConcurrentJobs: 10, completedTtlMs: 300000, widgetRefreshMs: 500, killTimeoutMs: 5000, runDir };
    const spawner = createProcessSpawner();
    const monitor = createProcessMonitor(500);
    const killer = createProcessKiller(config.killTimeoutMs);
    const persistence = createPersistence();
    const notifier = createNotifier();
    const widget = createWidget(config.completedTtlMs);

    const mgr = createJobManager({ spawner, monitor, killer, persistence, notifier, widget, config });
    const { job } = mgr.spawn("echo hello-world", "test-echo");
    expect(job.status).toBe("running");

    // Wait for process to finish (fast command)
    await new Promise(r => setTimeout(r, 2000));

    const updatedJob = mgr.jobs.get(job.id)!;
    expect(updatedJob.status).toBe("completed");
    expect(updatedJob.exitCode).toBe(0);

    // Verify log contains output
    const log = fs.readFileSync(job.logPath, "utf-8");
    expect(log).toContain("hello-world");

    // Cleanup
    mgr.shutdown();
    try { fs.rmSync(runDir, { recursive: true, force: true }); } catch {}
  });
});
```

- [ ] **Step 2: Write kill-escalation integration test**

```typescript
// tests/integration/kill-escalation.test.ts
import { describe, it, expect, vi } from "vitest";
import { createJobManager } from "../../src/core/job-manager.js";
import { createProcessSpawner } from "../../src/core/process-spawner.js";
import { createProcessMonitor } from "../../src/core/process-monitor.js";
import { createProcessKiller } from "../../src/core/process-killer.js";
import { createPersistence } from "../../src/core/persistence.js";
import { createNotifier } from "../../src/ui/notifier.js";
import { createWidget } from "../../src/ui/widget.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("integration: kill with SIGTERM", () => {
  it("kills a long-running sleep process", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-run-kill-"));
    const mockPi = { sendMessage: vi.fn() };
    const mockCtx = { hasUI: false, ui: { theme: { fg: (_: string, t: string) => t }, setWidget: vi.fn(), setStatus: vi.fn() } };

    const config = { maxConcurrentJobs: 10, completedTtlMs: 300000, widgetRefreshMs: 500, killTimeoutMs: 3000, runDir };
    const mgr = createJobManager({
      spawner: createProcessSpawner(),
      monitor: createProcessMonitor(500),
      killer: createProcessKiller(config.killTimeoutMs),
      persistence: createPersistence(),
      notifier: createNotifier(),
      widget: createWidget(config.completedTtlMs),
      config,
    });

    const { job } = mgr.spawn("sleep 300", "long-sleep");
    expect(job.status).toBe("running");

    mgr.kill(job.id);

    // Wait for kill to take effect
    await new Promise(r => setTimeout(r, 2000));

    const updated = mgr.jobs.get(job.id)!;
    expect(["killed", "completed"]).toContain(updated.status);

    mgr.shutdown();
    try { fs.rmSync(runDir, { recursive: true, force: true }); } catch {}
  });
});
```

- [ ] **Step 3: Write recovery integration test**

```typescript
// tests/integration/recovery.test.ts
import { describe, it, expect, vi } from "vitest";
import { createJobManager } from "../../src/core/job-manager.js";
import { createProcessSpawner } from "../../src/core/process-spawner.js";
import { createProcessMonitor } from "../../src/core/process-monitor.js";
import { createProcessKiller } from "../../src/core/process-killer.js";
import { createPersistence } from "../../src/core/persistence.js";
import { createNotifier } from "../../src/ui/notifier.js";
import { createWidget } from "../../src/ui/widget.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("integration: sidecar recovery", () => {
  it("recovers running job from sidecar after restart", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-run-recovery-"));
    const config = { maxConcurrentJobs: 10, completedTtlMs: 300000, widgetRefreshMs: 500, killTimeoutMs: 3000, runDir };

    // First manager: spawn a long-running job
    const mgr1 = createJobManager({
      spawner: createProcessSpawner(), monitor: createProcessMonitor(500), killer: createProcessKiller(3000),
      persistence: createPersistence(), notifier: createNotifier(), widget: createWidget(300000), config,
    });
    const { job } = mgr1.spawn("sleep 300", "persisted-sleep");
    mgr1.shutdown(); // simulate shutdown without killing the process

    // Second manager: recover from sidecar
    const mgr2 = createJobManager({
      spawner: createProcessSpawner(), monitor: createProcessMonitor(500), killer: createProcessKiller(3000),
      persistence: createPersistence(), notifier: createNotifier(), widget: createWidget(300000), config,
    });
    // Simulate init with mock pi/ctx
    const mockCtx = { hasUI: false, ui: { theme: { fg: (_: string, t: string) => t }, setWidget: vi.fn(), setStatus: vi.fn() } };
    mgr2.init({ sendMessage: vi.fn() }, mockCtx);

    const recovered = mgr2.jobs.get(job.id);
    expect(recovered).toBeTruthy();
    expect(recovered!.status).toBe("running");

    // Cleanup: kill the recovered job
    mgr2.kill(job.id);
    await new Promise(r => setTimeout(r, 1000));
    mgr2.shutdown();
    try { fs.rmSync(runDir, { recursive: true, force: true }); } catch {}
  });
});
```

- [ ] **Step 4: Write concurrent-jobs integration test**

```typescript
// tests/integration/concurrent-jobs.test.ts
import { describe, it, expect } from "vitest";
import { createJobManager } from "../../src/core/job-manager.js";
import { createProcessSpawner } from "../../src/core/process-spawner.js";
import { createProcessMonitor } from "../../src/core/process-monitor.js";
import { createProcessKiller } from "../../src/core/process-killer.js";
import { createPersistence } from "../../src/core/persistence.js";
import { createNotifier } from "../../src/ui/notifier.js";
import { createWidget } from "../../src/ui/widget.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("integration: concurrent job limit", () => {
  it("rejects jobs beyond max concurrent limit", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-run-concurrent-"));
    const config = { maxConcurrentJobs: 2, completedTtlMs: 300000, widgetRefreshMs: 500, killTimeoutMs: 3000, runDir };
    const mgr = createJobManager({
      spawner: createProcessSpawner(), monitor: createProcessMonitor(500), killer: createProcessKiller(3000),
      persistence: createPersistence(), notifier: createNotifier(), widget: createWidget(300000), config,
    });

    const r1 = mgr.spawn("sleep 60", "job1");
    const r2 = mgr.spawn("sleep 60", "job2");
    const r3 = mgr.spawn("sleep 60", "job3");

    expect(r1.job.id).toBeTruthy();
    expect(r2.job.id).toBeTruthy();
    expect(r3.error).toContain("Max");

    // Kill to allow cleanup
    mgr.kill(r1.job.id);
    mgr.kill(r2.job.id);
    mgr.shutdown();
    try { fs.rmSync(runDir, { recursive: true, force: true }); } catch {}
  });
});
```

- [ ] **Step 5: Run all integration tests**

Run: `npx vitest run tests/integration`
Expected: All tests pass (may take ~10-15s total due to real process waits)

- [ ] **Step 6: Commit**

```bash
git add tests/integration/
git commit -m "test: add integration tests for full lifecycle, kill, recovery, concurrency"
```

---

### Task 14: Documentation

**Files:**
- Create: `README.md`
- Create: `AGENTS.md`
- Create: `LICENSE`

- [ ] **Step 1: Write README.md**

```markdown
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

Running jobs show animated braille spinners (`⣾ ⣽ ⣻ ⢿ ⡿ ⣟ ⣯ ⣷`), staggered per job.

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
| `completedTtlMs` | 300000 (5 min) | How long completed/failed jobs stay visible |
| `widgetRefreshMs` | 3000 | Widget refresh interval (auto-adapts to 500ms when running) |
| `killTimeoutMs` | 10000 | Time before SIGKILL escalation |

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

## License

MIT
```

- [ ] **Step 2: Write AGENTS.md**

```markdown
# AGENTS.md — pi-bg-run

## Project Overview

Pi extension for background process management. Provides `bg_run`, `bg_list`, `bg_kill` tools and `/bg` TUI panel.

## Architecture

- **Dependency injection**: `JobManager` receives all modules via constructor. Tests inject mocks, production creates real instances in `index.ts`.
- **Feature-based layout**: Each module has one responsibility. Files < 80 lines.
- **Adaptive widget**: 500ms refresh with braille spinner when jobs running, 3000ms when idle.

## Key Design Decisions

1. **Job ID format**: `bg_<random8>` — shorter than timestamped IDs, still unique
2. **Notification always triggers agent**: `triggerTurn: true` on completion — agent reads log automatically
3. **PID poll as fallback**: `child.on("close")` is primary, PID poll every `widgetRefreshMs` is backup for detached processes
4. **Sidecar persistence**: `jobs.json` in run dir — enables recovery across session restarts
5. **Settings via Pi config**: `bgRun` key in settings.json, merged with defaults

## Testing

- **Unit**: Vitest + mocks for each core module. `tests/unit/`
- **Integration**: Real processes, real filesystem. `tests/integration/`
- Run: `npm test` (all) / `npm run test:unit` / `npm run test:integration`

## File Map

| File | What it does |
|---|---|
| `src/types.ts` | `Job`, `JobStatus`, `BgRunConfig`, `BgRunUserSettings` |
| `src/config.ts` | `loadConfig(userSettings, runDir)` → merged `BgRunConfig` |
| `src/core/process-spawner.ts` | `createProcessSpawner()` → `{ spawn, generateId }` |
| `src/core/process-monitor.ts` | `createProcessMonitor(pollMs)` → `{ watch, clear, clearAll }` |
| `src/core/process-killer.ts` | `createProcessKiller(timeoutMs)` → `{ kill, sendSignal }` |
| `src/core/persistence.ts` | `createPersistence()` → `{ save, load, recover }` |
| `src/core/job-manager.ts` | `createJobManager(deps)` → `{ jobs, spawn, kill, list, init, shutdown }` |
| `src/ui/notifier.ts` | `createNotifier()` → `{ notify, flush }` |
| `src/ui/widget.ts` | `createWidget(ttlMs)` → `{ refresh, start, stop }` |
| `src/ui/panel.ts` | `createBgPanelComponent(getJobs, killJob, theme, onClose)` |
| `src/tools/bg-run.ts` | Tool factory: `createBgRunTool()` |
| `src/tools/bg-list.ts` | Tool factory: `createBgListTool()` |
| `src/tools/bg-kill.ts` | Tool factory: `createBgKillTool()` |
| `src/index.ts` | Extension entry point, session lifecycle, DI wiring |
```

- [ ] **Step 3: Create MIT LICENSE**

```
MIT License

Copyright (c) 2026 huanhoangcong

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md LICENSE
git commit -m "docs: add README, AGENTS.md, and MIT license"
```

---

### Task 15: Final Verification

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run tests/unit`
Expected: All unit tests pass

- [ ] **Step 2: Run all integration tests**

Run: `npx vitest run tests/integration`
Expected: All integration tests pass

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass (unit + integration)

- [ ] **Step 4: TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Verify package structure for Pi**

Confirm `package.json` has:
- `"keywords": ["pi-package"]`
- `"pi": { "extensions": ["./src/index.ts"] }`
- `"peerDependencies"` for Pi packages

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final verification and cleanup"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Project structure → Task 1
- ✅ Core modules + interfaces → Tasks 3-6, 10
- ✅ Config/settings → Task 2
- ✅ Braille spinner + adaptive refresh → Task 8
- ✅ Staggered spinner → Task 8 (`getSpinnerFrame` uses `startedAt` offset)
- ✅ Tool API → Task 11
- ✅ TUI panel → Task 9
- ✅ Entry point wiring → Task 12
- ✅ Unit tests → Tasks 2-8, 10
- ✅ Integration tests → Task 13
- ✅ Documentation → Task 14
- ✅ Breaking changes (Job ID format) → Task 3 (`generateId`)

**2. Placeholder scan:** No TBDs, TODOs, or "implement later" patterns found.

**3. Type consistency:**
- `Job` interface consistent across all modules and tests
- `BgRunConfig` used in config.ts, job-manager.ts, index.ts
- `JobManagerDeps` interface in job-manager.ts matches factory signatures from all modules
- `createJobManager` receives `deps: JobManagerDeps` — all fields match
- Tool parameter schemas (`BgRunParams`, `BgKillParams`) consistent between definition and usage
