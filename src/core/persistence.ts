import * as fs from "node:fs";
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

  return { save, load, recover };
}
