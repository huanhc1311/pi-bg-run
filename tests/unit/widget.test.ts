import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWidget } from "../../src/ui/widget.js";
import type { Job } from "../../src/types.js";

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
    const lines: string[] = ctx.ui.setWidget.mock.calls[0][1];
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
    const lines: string[] = ctx.ui.setWidget.mock.calls[0][1];
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
    const lines: string[] = ctx.ui.setWidget.mock.calls[0][1];
    const spinnerChars = new Set(["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"]);
    const found = lines.filter((l: string) => [...spinnerChars].some(c => l.includes(c)));
    expect(found.length).toBe(2);
  });

  it("updates status bar with running count", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    widget.refresh([baseJob], ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("bg-run", "🏃 1 bg job");
  });

  it("clears status bar when no running jobs", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    widget.refresh([], ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("bg-run", undefined);
  });

  it("start triggers periodic refresh", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    const getJobs = () => [baseJob];
    widget.start(getJobs, ctx);
    // Should have called refresh at least once (initial tick)
    expect(ctx.ui.setWidget).toHaveBeenCalled();
    widget.stop();
  });

  it("stops refreshing after stop()", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    const getJobs = () => [baseJob];
    widget.start(getJobs, ctx);
    const callCount = ctx.ui.setWidget.mock.calls.length;
    widget.stop();
    vi.advanceTimersByTime(5000);
    expect(ctx.ui.setWidget.mock.calls.length).toBe(callCount);
  });
});
