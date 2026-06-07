import { describe, it, expect, vi } from "vitest";
import { createJobManager } from "../../src/core/job-manager.js";
import type { Job } from "../../src/types.js";

function mockDeps() {
  return {
    spawner: {
      spawn: vi.fn(() => ({ pid: 1234, logPath: "/tmp/bg_test.log", child: { on: vi.fn(), unref: vi.fn() } })),
      generateId: vi.fn(() => "bg_testid1"),
    },
    monitor: { watch: vi.fn(() => vi.fn()), clear: vi.fn(), clearAll: vi.fn() },
    killer: { kill: vi.fn(async () => {}), sendSignal: vi.fn() },
    persistence: { save: vi.fn(), load: vi.fn(() => [] as Job[]), recover: vi.fn((jobs: Job[]) => jobs), cleanLogs: vi.fn(() => []), cleanDir: vi.fn(), gc: vi.fn() },
    notifier: { notify: vi.fn(), flush: vi.fn() },
    widget: { refresh: vi.fn(), start: vi.fn(), stop: vi.fn() },
    config: { maxConcurrentJobs: 10, completedTtlMs: 300_000, widgetRefreshMs: 3000, killTimeoutMs: 10000, runDir: "/tmp/test-run" },
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
    // Verify close/error handlers registered (unref deferred to handlers)
    const child = result.job as any;
    const spawnResult = deps.spawner.spawn.mock.results[0].value;
    expect(spawnResult.child.on).toHaveBeenCalledWith("close", expect.any(Function));
    expect(spawnResult.child.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(spawnResult.child.unref).not.toHaveBeenCalled();
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
    const mockPi = { sendMessage: vi.fn() };
    const mockCtx = { hasUI: false, ui: { theme: { fg: (_: string, t: string) => t }, setWidget: vi.fn(), setStatus: vi.fn() } };
    mgr.init(mockPi, mockCtx);
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

  it("onExit sets notifiedAt when pi is available", () => {
    const deps = mockDeps();
    const mgr = createJobManager(deps as any);
    const mockPi = { sendMessage: vi.fn() };
    const mockCtx = { hasUI: false, ui: { theme: { fg: (_: string, t: string) => t }, setWidget: vi.fn(), setStatus: vi.fn() } };
    mgr.init(mockPi, mockCtx);
    mgr.spawn("cmd", "test");
    const onExit = deps.monitor.watch.mock.calls[0][2] as () => void;
    onExit();
    const job = Array.from(mgr.jobs.values())[0];
    expect(job.notifiedAt).toBeGreaterThan(0);
    expect(deps.persistence.save).toHaveBeenCalledTimes(4); // init + spawn + exit + post-notify
  });

  it("onExit via child close handler unreffed child", () => {
    const deps = mockDeps();
    const mgr = createJobManager(deps as any);
    const mockPi = { sendMessage: vi.fn() };
    const mockCtx = { hasUI: false, ui: { theme: { fg: (_: string, t: string) => t }, setWidget: vi.fn(), setStatus: vi.fn() } };
    mgr.init(mockPi, mockCtx);
    mgr.spawn("cmd", "test");
    // Get the close handler registered on child
    const spawnResult = deps.spawner.spawn.mock.results[0].value;
    const closeHandler = spawnResult.child.on.mock.calls.find((c: string[]) => c[0] === "close")?.[1] as (code: number | null) => void;
    closeHandler(0);
    // Child should be unreffed after close fires
    expect(spawnResult.child.unref).toHaveBeenCalled();
    const job = Array.from(mgr.jobs.values())[0];
    expect(job.status).toBe("completed");
    expect(job.exitCode).toBe(0);
  });

  it("onExit marks killed jobs correctly", () => {
    const deps = mockDeps();
    const mgr = createJobManager(deps as any);
    mgr.spawn("cmd", "test");
    mgr.kill("bg_testid1"); // marks as killed
    // Simulate exit
    const onExit = deps.monitor.watch.mock.calls[0][2] as () => void;
    onExit();
    const jobs = Array.from(mgr.jobs.values());
    expect(jobs[0].status).toBe("killed");
  });

  it("shutdown stops widget, flushes notifier, clears monitors", () => {
    const deps = mockDeps();
    const mgr = createJobManager(deps as any);
    const mockPi = { sendMessage: vi.fn() };
    const mockCtx = { hasUI: false, ui: { theme: { fg: (_: string, t: string) => t }, setWidget: vi.fn(), setStatus: vi.fn() } };
    mgr.init(mockPi, mockCtx);
    mgr.shutdown();
    expect(deps.widget.stop).toHaveBeenCalled();
    expect(deps.notifier.flush).toHaveBeenCalled();
    expect(deps.monitor.clearAll).toHaveBeenCalled();
  });

  it("init recovers from sidecar and starts widget", () => {
    const deps = mockDeps();
    deps.persistence.load = vi.fn(() => [
      { id: "bg_recovered", label: "old", command: "cmd", logPath: "/tmp/old.log", pid: 999, status: "running", exitCode: null, startedAt: 1000, endedAt: null, notifiedAt: null },
    ]);
    deps.persistence.recover = vi.fn((jobs: Job[]) => jobs);
    const mgr = createJobManager(deps as any);
    const mockPi = { sendMessage: vi.fn() };
    const mockCtx = { hasUI: false, ui: { theme: { fg: (_: string, t: string) => t }, setWidget: vi.fn(), setStatus: vi.fn() } };
    mgr.init(mockPi, mockCtx);
    expect(deps.persistence.load).toHaveBeenCalled();
    expect(deps.persistence.recover).toHaveBeenCalled();
    expect(deps.widget.start).toHaveBeenCalled();
    expect(mgr.jobs.has("bg_recovered")).toBe(true);
  });

  it("list returns formatted string with running and completed jobs", () => {
    const deps = mockDeps();
    const mgr = createJobManager(deps as any);
    mgr.spawn("cmd", "test");
    const output = mgr.list();
    expect(output).toContain("Running");
    expect(output).toContain("test");
  });
});
