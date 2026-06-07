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
    const config = { maxConcurrentJobs: 10, completedTtlMs: 300_000, widgetRefreshMs: 500, killTimeoutMs: 3000, runDir };

    // First manager: spawn a long-running job
    const killer1 = createProcessKiller(3000);
    const mgr1 = createJobManager({
      spawner: createProcessSpawner(),
      monitor: createProcessMonitor(500),
      killer: { kill: (pid: number) => killer1.kill(pid), sendSignal: killer1.sendSignal },
      persistence: createPersistence(),
      notifier: createNotifier(),
      widget: createWidget(300_000),
      config,
    });
    const { job } = mgr1.spawn("sleep 300", "persisted-sleep");
    expect(job.status).toBe("running");

    // Shutdown without killing the process
    mgr1.shutdown();

    // Second manager: recover from sidecar
    const mockCtx = {
      hasUI: false,
      ui: { theme: { fg: (_: string, t: string) => t, bold: (t: string) => t }, setWidget: vi.fn(), setStatus: vi.fn() },
    };
    const killer2 = createProcessKiller(3000);
    const mgr2 = createJobManager({
      spawner: createProcessSpawner(),
      monitor: createProcessMonitor(500),
      killer: { kill: (pid: number) => killer2.kill(pid), sendSignal: killer2.sendSignal },
      persistence: createPersistence(),
      notifier: createNotifier(),
      widget: createWidget(300_000),
      config,
    });
    mgr2.init({ sendMessage: vi.fn() }, mockCtx);

    const recovered = mgr2.jobs.get(job.id);
    expect(recovered).toBeTruthy();
    expect(recovered!.status).toBe("running");

    // Cleanup
    mgr2.kill(job.id);
    await new Promise(r => setTimeout(r, 1000));
    mgr2.shutdown();
    try { fs.rmSync(runDir, { recursive: true, force: true }); } catch {}
  });
});
