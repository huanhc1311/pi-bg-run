import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProcessMonitor } from "../../src/core/process-monitor.js";

describe("ProcessMonitor", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("calls onExit when PID poll detects process is dead", () => {
    const monitor = createProcessMonitor(1000);
    const onExit = vi.fn();
    vi.spyOn(process, "kill").mockImplementation((pid: number, signal: any) => {
      if (signal === 0) throw new Error("ESRCH");
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
    vi.spyOn(process, "kill").mockImplementation((pid: number, signal: any) => {
      if (signal === 0) throw new Error("ESRCH");
      return true;
    });

    monitor.watch("job4", 666, onExit);
    vi.advanceTimersByTime(3000);
    expect(onExit).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
