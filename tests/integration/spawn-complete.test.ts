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
    const mockCtx = {
      hasUI: false,
      ui: { theme: { fg: (_: string, t: string) => t, bold: (t: string) => t }, setWidget: vi.fn(), setStatus: vi.fn() },
    };

    const config = { maxConcurrentJobs: 10, completedTtlMs: 300_000, widgetRefreshMs: 500, killTimeoutMs: 5000, runDir };
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

    const { job } = mgr.spawn("echo hello-world", "test-echo");
    expect(job.status).toBe("running");
    expect(job.id).toBeTruthy();

    // Wait for process to finish (echo is fast, but poll interval is 500ms)
    await new Promise(r => setTimeout(r, 2000));

    const updatedJob = mgr.jobs.get(job.id)!;
    expect(updatedJob.status).toBe("completed");
    expect(updatedJob.exitCode).toBe(0);

    // Verify log contains output
    const log = fs.readFileSync(job.logPath, "utf-8");
    expect(log).toContain("hello-world");

    mgr.shutdown();
    try { fs.rmSync(runDir, { recursive: true, force: true }); } catch {}
  });
});
