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

  it("renders running jobs as single line with spinner", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    widget.refresh([baseJob], ctx);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("bg-run", [expect.any(String)]);
    const line: string = ctx.ui.setWidget.mock.calls[0][1][0];
    const spinnerChars = ["✶", "✷", "✵", "✴", "✳", "✲", "✱", "✺"];
    expect(spinnerChars.some(c => line.includes(c))).toBe(true);
    expect(line).toContain("build");
    expect(line).toContain("bg:");
  });

  it("renders completed jobs as collapsed summary", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    const completedJob = { ...baseJob, status: "completed" as const, exitCode: 0, endedAt: Date.now() };
    widget.refresh([completedJob], ctx);
    const line: string = ctx.ui.setWidget.mock.calls[0][1][0];
    expect(line).toContain("bg:");
    expect(line).toContain("1 done");
    expect(line).not.toContain("✶");
  });

  it("shows running + completed summary together", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    const completedJob = { ...baseJob, status: "completed" as const, exitCode: 0, endedAt: Date.now() };
    const runningJob = { ...baseJob, id: "bg_other", label: "train" };
    widget.refresh([runningJob, completedJob], ctx);
    const line: string = ctx.ui.setWidget.mock.calls[0][1][0];
    expect(line).toContain("train");
    expect(line).toContain("1 done");
  });

  it("counts multiple completed by status", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    const jobs: Job[] = [
      { ...baseJob, id: "bg_a", status: "completed", exitCode: 0, endedAt: Date.now() },
      { ...baseJob, id: "bg_b", status: "completed", exitCode: 0, endedAt: Date.now() },
      { ...baseJob, id: "bg_c", status: "failed", exitCode: 1, endedAt: Date.now() },
      { ...baseJob, id: "bg_d", status: "killed", exitCode: null, endedAt: Date.now() },
    ];
    widget.refresh(jobs, ctx);
    const line: string = ctx.ui.setWidget.mock.calls[0][1][0];
    expect(line).toContain("2 done");
    expect(line).toContain("1 failed");
    expect(line).toContain("1 killed");
  });

  it("ignores old completed jobs outside TTL", () => {
    const widget = createWidget(5_000);
    const ctx = mockContext();
    const oldJob: Job = {
      ...baseJob, id: "bg_old", status: "completed", exitCode: 0,
      endedAt: Date.now() - 10_000,
    };
    widget.refresh([oldJob], ctx);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("bg-run", undefined);
  });

  it("auto-dismisses completed summary after SUMMARY_TTL", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    const endedAt = Date.now();
    const completedJob = { ...baseJob, status: "completed" as const, exitCode: 0, endedAt };
    widget.refresh([completedJob], ctx);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("bg-run", [expect.any(String)]);

    vi.advanceTimersByTime(9_999);
    widget.refresh([{ ...completedJob, endedAt }], ctx);
    expect(ctx.ui.setWidget).not.toHaveBeenCalledWith("bg-run", undefined);

    vi.advanceTimersByTime(2);
    widget.refresh([{ ...completedJob, endedAt }], ctx);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("bg-run", undefined);
  });

  it("clears widget when no jobs to show", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    widget.refresh([], ctx);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("bg-run", undefined);
  });

  it("updates status bar with running count", () => {
    const widget = createWidget(300_000);
    const ctx = mockContext();
    widget.refresh([baseJob], ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("bg-run", "1 bg job");
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
