import * as fs from "node:fs";
import * as path from "node:path";
import type { Job } from "../types.js";

export function createPersistence() {
  function save(jobs: Job[], sidecarPath: string): void {
    try {
      fs.writeFileSync(sidecarPath, JSON.stringify({ jobs }, null, 2));
    } catch { /* best effort */ }
  }

  function load(sidecarPath: string): Job[] {
    try {
      if (!fs.existsSync(sidecarPath)) return [];
      const data = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"));
      return data.jobs ?? [];
    } catch { return []; }
  }

  function recover(jobs: Job[]): Job[] {
    return jobs.map(job => {
      if (job.status !== "running") return job;
      try {
        process.kill(job.pid, 0);
        return job;
      } catch {
        return { ...job, status: "completed" as const, exitCode: null, endedAt: Date.now() };
      }
    });
  }

  /** Remove stale log files and their entries from jobs.json */
  function cleanLogs(jobs: Job[], ttlMs: number, sidecarPath: string): Job[] {
    const now = Date.now();
    const kept: Job[] = [];
    for (const job of jobs) {
      if (job.status === "running") { kept.push(job); continue; }
      if (!job.endedAt || now - job.endedAt < ttlMs) { kept.push(job); continue; }
      // Stale — remove log file
      try { fs.unlinkSync(job.logPath); } catch { /* already gone */ }
    }
    save(kept, sidecarPath);
    return kept;
  }

  /** Remove entire project dir if empty after cleanup */
  function cleanDir(runDir: string): void {
    try {
      const files = fs.readdirSync(runDir);
      if (files.length === 0) fs.rmdirSync(runDir);
    } catch { /* already gone */ }
  }

  /** Scan base dir and remove stale project dirs */
  function gc(baseDir: string, ttlMs: number): void {
    let entries: string[];
    try { entries = fs.readdirSync(baseDir); } catch { return; }
    const now = Date.now();
    for (const entry of entries) {
      const dir = path.join(baseDir, entry);
      let stat: fs.Stats;
      try { stat = fs.statSync(dir); } catch { continue; }
      if (!stat.isDirectory()) continue;
      const sidecar = path.join(dir, "jobs.json");
      if (!fs.existsSync(sidecar)) {
        // No sidecar — stale dir, remove if old enough
        if (now - stat.mtimeMs >= ttlMs) {
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        }
        continue;
      }
      const jobs = load(sidecar);
      const hasRunning = jobs.some(j => j.status === "running");
      if (hasRunning) continue;

      // Clean stale entries — remove logs + update jobs.json
      const kept = cleanLogs(jobs, ttlMs, sidecar);

      // If no entries left, remove the whole dir
      if (kept.length === 0) {
        try { fs.unlinkSync(sidecar); } catch {}
        try { fs.rmdirSync(dir); } catch {}
      }
    }
  }

  return { save, load, recover, cleanLogs, cleanDir, gc };
}
