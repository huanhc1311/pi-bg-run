import type { Job, BgRunConfig } from "../types.js";

export interface JobManagerDeps {
  spawner: { spawn: (cmd: string, runDir: string) => { pid: number; logPath: string; child: any }; generateId: () => string };
  monitor: { watch: (jobId: string, pid: number, onExit: () => void) => () => void; clear: (jobId: string) => void; clearAll: () => void };
  killer: { kill: (pid: number, timeoutMs: number) => Promise<void> };
  persistence: { save: (jobs: Job[], path: string) => void; load: (path: string) => Job[]; recover: (jobs: Job[]) => Job[] };
  notifier: { notify: (job: Job, pi: any) => void; flush: (pi: any, sync: boolean) => void };
  widget: { refresh: (jobs: Job[], ctx: any) => void; start: (getJobs: () => Job[], ctx: any) => void; stop: () => void };
  config: BgRunConfig;
}

export function createJobManager(deps: JobManagerDeps) {
  const jobs = new Map<string, Job>();
  const unwatchFns = new Map<string, () => void>();
  const killedIds = new Set<string>();
  let pi: any = null;
  let ctx: any = null;

  function autoLabel(command: string): string {
    const t = command.trim().replace(/\s+/g, " ");
    return t.length > 50 ? t.slice(0, 47) + "..." : t;
  }

  function emptyJob(): Job {
    return { id: "", label: "", command: "", logPath: "", pid: 0, status: "failed", exitCode: null, startedAt: 0, endedAt: null, notifiedAt: null };
  }

  function sidecarPath(): string {
    return `${deps.config.runDir}/jobs.json`;
  }

  function fmtElapsed(job: Job): string {
    const ms = job.endedAt ? job.endedAt - job.startedAt : Date.now() - job.startedAt;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function spawn(command: string, label: string): { job: Job; error?: string } {
    if (!command?.trim()) return { job: emptyJob(), error: "Command cannot be empty" };
    const runningCount = Array.from(jobs.values()).filter(j => j.status === "running").length;
    if (runningCount >= deps.config.maxConcurrentJobs) {
      return { job: emptyJob(), error: `Max ${deps.config.maxConcurrentJobs} concurrent jobs. Use bg_list to check, bg_kill to free slots.` };
    }
    const id = deps.spawner.generateId();
    let result: { pid: number; logPath: string; child: any };
    try { result = deps.spawner.spawn(command, deps.config.runDir); }
    catch (err: any) { return { job: emptyJob(), error: err.message }; }

    const job: Job = {
      id, label: label || autoLabel(command), command, logPath: result.logPath, pid: result.pid,
      status: "running", exitCode: null, startedAt: Date.now(), endedAt: null, notifiedAt: null,
    };
    jobs.set(id, job);
    unwatchFns.set(id, deps.monitor.watch(id, result.pid, () => onExit(id, 0)));
    result.child.on?.("close", (code: number | null) => onExit(id, code));
    result.child.on?.("error", () => onExit(id, 1));
    deps.persistence.save(Array.from(jobs.values()), sidecarPath());
    return { job };
  }

  function kill(jobId: string): { success: boolean; message: string } {
    const job = jobs.get(jobId);
    if (!job) return { success: false, message: `Job ${jobId} not found` };
    if (job.status !== "running") return { success: false, message: `Job ${jobId} not running (${job.status})` };
    killedIds.add(jobId);
    deps.killer.kill(job.pid, deps.config.killTimeoutMs);
    return { success: true, message: `Sent SIGTERM to ${jobId} (PID ${job.pid}): ${job.label}` };
  }

  function list(): string {
    const running = Array.from(jobs.values()).filter(j => j.status === "running");
    const completed = Array.from(jobs.values()).filter(j => j.status === "completed" && j.endedAt && Date.now() - j.endedAt < deps.config.completedTtlMs);
    const failed = Array.from(jobs.values()).filter(j => (j.status === "failed" || j.status === "killed") && j.endedAt && Date.now() - j.endedAt < deps.config.completedTtlMs);
    let out = "";
    if (running.length) {
      out += `🏃 Running (${running.length}):\n`;
      for (const j of running) out += `  [${j.id}] ${j.label.padEnd(30)} ${fmtElapsed(j)}   ${j.logPath}\n`;
      out += "\n";
    }
    if (completed.length) {
      out += `✅ Completed (${completed.length}):\n`;
      for (const j of completed) out += `  [${j.id}] ${j.label.padEnd(30)} ${fmtElapsed(j)}   exit ${j.exitCode}   ${j.logPath}\n`;
      out += "\n";
    }
    if (failed.length) {
      out += `❌ Failed/Killed (${failed.length}):\n`;
      for (const j of failed) out += `  [${j.id}] ${j.label.padEnd(30)} ${fmtElapsed(j)}   ${j.status === "killed" ? "killed" : `exit ${j.exitCode}`}   ${j.logPath}\n`;
      out += "\n";
    }
    return out.trim() || "No background jobs. Use bg_run to start one.";
  }

  function onExit(id: string, code: number | null) {
    deps.monitor.clear(id);
    unwatchFns.delete(id);
    const job = jobs.get(id);
    if (!job || job.status !== "running") return;
    const wasKilled = killedIds.has(id);
    job.exitCode = code;
    job.endedAt = Date.now();
    if (wasKilled) { job.status = "killed"; killedIds.delete(id); }
    else { job.status = code === 0 ? "completed" : "failed"; }
    deps.persistence.save(Array.from(jobs.values()), sidecarPath());
    deps.widget.refresh(Array.from(jobs.values()), ctx);
    if (pi) {
      job.notifiedAt = Date.now();
      deps.persistence.save(Array.from(jobs.values()), sidecarPath());
      deps.notifier.notify(job, pi);
    }
  }

  function init(piRef: any, ctxRef: any) {
    pi = piRef;
    ctx = ctxRef;
    const loaded = deps.persistence.load(sidecarPath());
    const recovered = deps.persistence.recover(loaded);
    for (const job of recovered) {
      jobs.set(job.id, job);
      if (job.status === "running") {
        unwatchFns.set(job.id, deps.monitor.watch(job.id, job.pid, () => onExit(job.id, null)));
      }
    }
    deps.persistence.save(Array.from(jobs.values()), sidecarPath());
    deps.widget.start(() => Array.from(jobs.values()), ctx);
  }

  function shutdown() {
    let killed = 0;
    for (const [id, job] of jobs) {
      if (job.status === "running") { killedIds.add(id); deps.killer.kill(job.pid, deps.config.killTimeoutMs); killed++; }
    }
    deps.widget.stop();
    deps.monitor.clearAll();
    for (const unwatch of unwatchFns.values()) unwatch();
    unwatchFns.clear();
    if (pi) deps.notifier.flush(pi, true);
    if (killed > 0) {
      setTimeout(() => {
        try { require("node:fs").rmSync(deps.config.runDir, { recursive: true, force: true }); } catch {}
      }, 15_000);
    }
  }

  return { jobs, spawn, kill, list, init, shutdown };
}
