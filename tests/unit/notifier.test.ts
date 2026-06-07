import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNotifier } from "../../src/ui/notifier.js";
import type { Job } from "../../src/types.js";

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

  it("sends notification for single job", () => {
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
    vi.advanceTimersByTime(200);
    expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("formats killed job with correct icon", () => {
    const killedJob: Job = { ...completedJob, status: "killed", id: "bg_kil12345", label: "stuck" };
    const notifier = createNotifier();
    notifier.notify(killedJob, mockPi);
    vi.advanceTimersByTime(100);
    const msg = mockPi.sendMessage.mock.calls[0][0].content;
    expect(msg).toContain("killed");
  });

  it("uses deliverAs steer with triggerTurn true", () => {
    const notifier = createNotifier();
    notifier.notify(completedJob, mockPi);
    vi.advanceTimersByTime(100);
    const options = mockPi.sendMessage.mock.calls[0][1];
    expect(options.deliverAs).toBe("steer");
    expect(options.triggerTurn).toBe(true);
  });
});
