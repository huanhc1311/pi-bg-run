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
    const config = { maxConcurrentJobs: 10, completedTtlMs: 300_000, widgetRefreshMs: 500, killTimeoutMs: 3000, runDir };

    const killer = createProcessKiller(config.killTimeoutMs);
    const mgr = createJobManager({
      spawner: createProcessSpawner(),
      monitor: createProcessMonitor(500),
      killer: { kill: (pid: number) => killer.kill(pid), sendSignal: killer.sendSignal },
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
