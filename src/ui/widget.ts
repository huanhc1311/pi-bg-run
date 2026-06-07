import type { Job } from "../types.js";

export const SPINNER_FRAMES = ["✶", "✷", "✵", "✴", "✳", "✲", "✱", "✺"];

export const ACTIVE_REFRESH_MS = 500;
const IDLE_REFRESH_MS = 3000;
const SUMMARY_TTL_MS = 10_000;

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function getSpinnerFrame(job: Job): string {
  const offset = Math.floor(job.startedAt / 1000) % SPINNER_FRAMES.length;
  const elapsed = Date.now() - job.startedAt;
  const frameIdx = (offset + Math.floor(elapsed / ACTIVE_REFRESH_MS)) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[frameIdx];
}

export interface WidgetContext {
  hasUI: boolean;
  ui: {
    theme: { fg: (color: string, text: string) => string; bold: (text: string) => string };
    setWidget: (name: string, lines: string[] | undefined) => void;
    setStatus: (name: string, text: string | undefined) => void;
  };
}

export function createWidget(completedTtlMs: number) {
  let timer: ReturnType<typeof setInterval> | null = null;

  function refresh(jobs: Job[], ctx: WidgetContext): void {
    try { if (!ctx.hasUI) return; } catch { return; }

    const now = Date.now();
    const running = jobs.filter(j => j.status === "running");

    // Only count completed jobs within TTL window — old jobs are irrelevant
    const recent = jobs.filter(j =>
      j.status !== "running" && j.endedAt && now - j.endedAt < completedTtlMs
    );
    const doneCount = recent.filter(j => j.status === "completed").length;
    const failCount = recent.filter(j => j.status === "failed").length;
    const killCount = recent.filter(j => j.status === "killed").length;
    const hasRecent = doneCount + failCount + killCount > 0;

    // Auto-dismiss: no running jobs and no recent completed jobs
    const lastEndedAt = recent.length > 0
      ? Math.max(...recent.map(j => j.endedAt!))
      : 0;

    if (running.length === 0 && (!hasRecent || now - lastEndedAt >= SUMMARY_TTL_MS)) {
      ctx.ui.setWidget("bg-run", undefined);
      ctx.ui.setStatus("bg-run", undefined);
      return;
    }

    const th = ctx.ui.theme;

    if (running.length > 0) {
      // Active: spinner + running details + completed summary
      const spinner = th.fg("warning", getSpinnerFrame(running[0]));
      const runningParts = running.map(j =>
        th.fg("text", `${j.label} ${formatDuration(Date.now() - j.startedAt)}`)
      );
      let line = ` ${spinner} bg: ${runningParts.join(", ")}`;

      if (hasRecent) {
        line += ` · ${summarizeCompleted(th, doneCount, failCount, killCount)}`;
      }

      ctx.ui.setWidget("bg-run", [line]);
    } else {
      ctx.ui.setWidget("bg-run", [` bg: ${summarizeCompleted(th, doneCount, failCount, killCount)}`]);
    }

    const n = running.length;
    ctx.ui.setStatus("bg-run", n === 0 ? undefined : n === 1 ? "1 bg job" : `${n} bg jobs`);
  }

  function start(getJobs: () => Job[], ctx: WidgetContext): void {
    stop();
    const tick = () => refresh(getJobs(), ctx);
    timer = setInterval(tick, ACTIVE_REFRESH_MS);
    tick();
  }

  function stop(): void {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { refresh, start, stop };
}

function summarizeCompleted(th: { fg: (c: string, t: string) => string }, done: number, fail: number, kill: number): string {
  const parts: string[] = [];
  if (done > 0) parts.push(th.fg("success", `${done} done`));
  if (fail > 0) parts.push(th.fg("error", `${fail} failed`));
  if (kill > 0) parts.push(th.fg("dim", `${kill} killed`));
  return parts.join(" · ");
}
