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
    const config = { maxConcurrentJobs: 2, completedTtlMs: 300_000, widgetRefreshMs: 500, killTimeoutMs: 3000, runDir };
    const killer = createProcessKiller(3000);
    const mgr = createJobManager({
      spawner: createProcessSpawner(),
      monitor: createProcessMonitor(500),
      killer: { kill: (pid: number) => killer.kill(pid), sendSignal: killer.sendSignal },
      persistence: createPersistence(),
      notifier: createNotifier(),
      widget: createWidget(300_000),
      config,
    });

    const r1 = mgr.spawn("sleep 60", "job1");
    const r2 = mgr.spawn("sleep 60", "job2");
    const r3 = mgr.spawn("sleep 60", "job3");

    expect(r1.job.id).toBeTruthy();
    expect(r2.job.id).toBeTruthy();
    expect(r3.error).toContain("Max");

    // Cleanup
    mgr.kill(r1.job.id);
    mgr.kill(r2.job.id);
    mgr.shutdown();
    try { fs.rmSync(runDir, { recursive: true, force: true }); } catch {}
  });
});
