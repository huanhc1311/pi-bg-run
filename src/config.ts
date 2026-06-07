import type { BgRunConfig, BgRunUserSettings } from "./types.js";

const DEFAULTS: Omit<BgRunConfig, "runDir"> = {
  maxConcurrentJobs: 10,
  completedTtlMs: 300_000,
  widgetRefreshMs: 3_000,
  killTimeoutMs: 10_000,
};

export function loadConfig(user: BgRunUserSettings | undefined, runDir: string): BgRunConfig {
  return {
    maxConcurrentJobs: user?.maxConcurrentJobs ?? DEFAULTS.maxConcurrentJobs,
    completedTtlMs: user?.completedTtlMs ?? DEFAULTS.completedTtlMs,
    widgetRefreshMs: user?.widgetRefreshMs ?? DEFAULTS.widgetRefreshMs,
    killTimeoutMs: user?.killTimeoutMs ?? DEFAULTS.killTimeoutMs,
    runDir,
  };
}
