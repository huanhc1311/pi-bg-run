import type { Job } from "../types.js";

const BATCH_MS = 50;

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function jobElapsed(job: Job): number {
  return job.endedAt ? job.endedAt - job.startedAt : Date.now() - job.startedAt;
}

interface PiLike {
  sendMessage: (msg: { customType: string; content: string; display: boolean }, opts: { deliverAs: string; triggerTurn: boolean }) => void;
}

export function createNotifier() {
  let pending: Job[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function notify(job: Job, pi: PiLike): void {
    pending.push(job);
    if (!timer) {
      timer = setTimeout(() => flush(pi, false), BATCH_MS);
    }
  }

  function flush(pi: PiLike, sync: boolean): void {
    if (timer) { clearTimeout(timer); timer = null; }
    const jobs = pending;
    pending = [];
    if (jobs.length === 0) return;

    let message: string;
    if (jobs.length === 1) {
      const j = jobs[0];
      const icon = j.status === "completed" ? "✅" : j.status === "killed" ? "🔴" : "❌";
      message = `🔔 Background job ${j.status}: ${j.label}\nID: ${j.id}\nStatus: ${icon} ${j.status} (exit ${j.exitCode})\nDuration: ${formatDuration(jobElapsed(j))}\nLog: ${j.logPath}\n\nRead the log to analyze results.`;
    } else {
      message = `🔔 ${jobs.length} background jobs completed:\n\n`;
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        const icon = j.status === "completed" ? "✅" : j.status === "killed" ? "🔴" : "❌";
        message += `${i + 1}. ${j.label} [${j.id}] — ${icon} ${j.status} (exit ${j.exitCode}) — ${formatDuration(jobElapsed(j))}\n   Log: ${j.logPath}\n\n`;
      }
      message += `Read the logs to analyze results.`;
    }
    try {
      pi.sendMessage(
        { customType: "bg-run-notify", content: message, display: true },
        { deliverAs: "steer", triggerTurn: true },
      );
    } catch { /* pi may be shutting down */ }
  }

  return { notify, flush };
}
