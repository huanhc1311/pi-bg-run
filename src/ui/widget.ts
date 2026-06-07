import type { Job } from "../types.js";

export const SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
export const ACTIVE_REFRESH_MS = 500;
const IDLE_REFRESH_MS = 3000;

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
    const running = jobs.filter(j => j.status === "running");
    const recent = jobs.filter(j => j.status !== "running" && j.endedAt && Date.now() - j.endedAt < completedTtlMs);

    if (running.length === 0 && recent.length === 0) {
      ctx.ui.setWidget("bg-run", undefined);
      ctx.ui.setStatus("bg-run", undefined);
      return;
    }

    const th = ctx.ui.theme;
    const lines: string[] = [th.fg("accent", " bg-run ")];
    for (const j of running) {
      const spinner = getSpinnerFrame(j);
      lines.push(` ${th.fg("warning", spinner)} ${th.fg("text", j.label.slice(0, 25).padEnd(25))} ${th.fg("dim", formatDuration(Date.now() - j.startedAt))}`);
    }
    for (const j of recent) {
      const icon = j.status === "completed" ? th.fg("success", "✅") : th.fg("error", j.status === "killed" ? "🔴" : "❌");
      lines.push(` ${icon} ${th.fg("dim", j.label.slice(0, 25).padEnd(25))} ${th.fg("dim", formatDuration((j.endedAt ?? Date.now()) - j.startedAt))}`);
    }
    ctx.ui.setWidget("bg-run", lines);

    const n = running.length;
    ctx.ui.setStatus("bg-run", n === 0 ? undefined : n === 1 ? "🏃 1 bg job" : `🏃 ${n} bg jobs`);
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
