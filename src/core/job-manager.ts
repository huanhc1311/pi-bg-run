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
  let activeSessions = 0;

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
    result.child.on?.("close", (code: number | null) => {
      result.child.unref();
      onExit(id, code);
    });
    result.child.on?.("error", () => {
      result.child.unref();
      onExit(id, 1);
    });
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
    activeSessions++;
    const fs = require("node:fs");
    fs.mkdirSync(deps.config.runDir, { recursive: true });

    // GC: remove stale project dirs across all projects
    deps.persistence.gc("/tmp/bg-run", deps.config.completedTtlMs);

    // Clean stale logs and entries for this project's completed jobs
    const preExisting = deps.persistence.load(sidecarPath());
    const preRecovered = deps.persistence.recover(preExisting);
    deps.persistence.cleanLogs(preRecovered, deps.config.completedTtlMs, sidecarPath());
    deps.persistence.cleanDir(deps.config.runDir);

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

  /** Attach an additional session to this project's manager */
  function attach(piRef: any, ctxRef: any) {
    pi = piRef;
    ctx = ctxRef;
    activeSessions++;
    deps.widget.start(() => Array.from(jobs.values()), ctx);
  }

  /** Detach a session — stop widget but keep jobs alive for other sessions */
  function detach(_ctxRef: any) {
    activeSessions = Math.max(0, activeSessions - 1);
    deps.widget.stop();
    if (activeSessions === 0 && pi) {
      deps.notifier.flush(pi, true);
    }
  }

  function shutdown() {
    for (const [id, job] of jobs) {
      if (job.status === "running") { killedIds.add(id); deps.killer.kill(job.pid, deps.config.killTimeoutMs); }
    }
    deps.widget.stop();
    deps.monitor.clearAll();
    for (const unwatch of unwatchFns.values()) unwatch();
    unwatchFns.clear();
    if (pi) deps.notifier.flush(pi, true);
  }

  return { jobs, spawn, kill, list, init, attach, detach, shutdown };
}
