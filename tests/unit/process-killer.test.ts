import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProcessKiller } from "../../src/core/process-killer.js";

describe("ProcessKiller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(process, "kill").mockReturnValue(true as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends SIGTERM to process group first", async () => {
    const killer = createProcessKiller(5000);
    const killPromise = killer.kill(1234);
    expect(process.kill).toHaveBeenCalledWith(-1234, "SIGTERM");
    // Make process dead to resolve
    vi.mocked(process.kill).mockImplementation(() => { throw new Error("ESRCH"); });
    await vi.advanceTimersByTimeAsync(200);
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
    // Make dead to resolve
    vi.mocked(process.kill).mockImplementation(() => { throw new Error("ESRCH"); });
    await vi.advanceTimersByTimeAsync(200);
    await killPromise;
  });

  it("escalates to SIGKILL after timeout", async () => {
    const killer = createProcessKiller(3000);
    const killPromise = killer.kill(9999);
    await vi.advanceTimersByTimeAsync(3000);
    expect(process.kill).toHaveBeenCalledWith(-9999, "SIGKILL");
    // Make dead to resolve
    vi.mocked(process.kill).mockImplementation(() => { throw new Error("ESRCH"); });
    await vi.advanceTimersByTimeAsync(200);
    await killPromise;
  });
});
