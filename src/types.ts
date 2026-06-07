export type JobStatus = "running" | "completed" | "failed" | "killed";

export interface Job {
  id: string;
  label: string;
  command: string;
  logPath: string;
  pid: number;
  status: JobStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  notifiedAt: number | null;
}

export interface BgRunConfig {
  maxConcurrentJobs: number;
  completedTtlMs: number;
  widgetRefreshMs: number;
  killTimeoutMs: number;
  runDir: string;
}

export interface BgRunUserSettings {
  maxConcurrentJobs?: number;
  completedTtlMs?: number;
  widgetRefreshMs?: number;
  killTimeoutMs?: number;
}
