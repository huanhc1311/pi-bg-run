import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Job } from "../types.js";
import { SPINNER_FRAMES, ACTIVE_REFRESH_MS } from "./widget.js";

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

function formatElapsed(job: Job): string {
  return formatDuration(job.endedAt ? job.endedAt - job.startedAt : Date.now() - job.startedAt);
}

interface ThemeLike {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
}

export function createBgPanelComponent(
  getJobs: () => Map<string, Job>,
  killJob: (id: string) => { success: boolean; message: string },
  theme: ThemeLike,
  onClose: () => void,
) {
  let selectedIndex = 0;
  let pendingKillId: string | null = null;
  let logPreview: string | null = null;
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;

  function getSortedJobs(): Job[] {
    return Array.from(getJobs().values()).sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (a.status !== "running" && b.status === "running") return 1;
      return b.startedAt - a.startedAt;
    });
  }

  function invalidate() { cachedWidth = undefined; cachedLines = undefined; }

  function handleInput(data: string): void {
    const jobs = getSortedJobs();
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") { onClose(); return; }
    if (matchesKey(data, "up")) { selectedIndex = Math.max(0, selectedIndex - 1); pendingKillId = null; logPreview = null; invalidate(); return; }
    if (matchesKey(data, "down")) { selectedIndex = Math.min(jobs.length - 1, selectedIndex + 1); pendingKillId = null; logPreview = null; invalidate(); return; }
    if (data === "k") {
      const job = jobs[selectedIndex];
      if (job?.status === "running") {
        if (pendingKillId === job.id) { killJob(job.id); pendingKillId = null; }
        else { pendingKillId = job.id; }
        invalidate();
      }
      return;
    }
    if (matchesKey(data, "return") || data === " ") {
      const job = jobs[selectedIndex];
      if (job) viewLogTail(job);
      return;
    }
  }

  function viewLogTail(job: Job) {
    let tail = "(log file not found)";
    try {
      if (fs.existsSync(job.logPath)) {
        tail = execSync(`tail -100 ${JSON.stringify(job.logPath)}`, { encoding: "utf-8", timeout: 5000 });
      }
    } catch { tail = "(error reading log file)"; }
    logPreview = tail;
    invalidate();
  }

  function render(width: number): string[] {
    if (cachedLines && cachedWidth === width) return cachedLines;
    const jobs = getSortedJobs();
    const th = theme;
    const lines: string[] = [];
    lines.push("");
    const title = th.fg("accent", " Background Jobs ");
    const border = th.fg("borderMuted", "─");
    lines.push(border.repeat(3) + title + border.repeat(Math.max(0, width - 20)));
    lines.push("");

    if (jobs.length === 0) {
      lines.push(truncateToWidth(`  ${th.fg("dim", "No background jobs. Use bg_run to start one.")}`, width));
    } else {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const selected = i === selectedIndex;
        const prefix = selected ? th.fg("accent", "▶ ") : "  ";
        let icon: string;
        switch (job.status) {
          case "running": icon = th.fg("warning", getSpinnerFrame(job)); break;
          case "completed": icon = th.fg("success", "✅"); break;
          case "failed": icon = th.fg("error", "❌"); break;
          case "killed": icon = th.fg("error", "🔴"); break;
        }
        const shortId = th.fg("dim", `[${job.id}]`);
        const label = selected ? th.bold(job.label.slice(0, 25)) : th.fg("text", job.label.slice(0, 25));
        const elapsed = th.fg("dim", formatElapsed(job));
        const killHint = pendingKillId === job.id ? th.fg("error", " [k again to confirm]") : "";
        lines.push(truncateToWidth(`${prefix}${icon} ${shortId} ${label.padEnd(25)} ${elapsed}${killHint}`, width));
      }
    }

    lines.push("");
    lines.push(truncateToWidth(`  ${th.fg("dim", "[↑/↓] Navigate  [Enter] View log  [k] Kill  [q] Quit")}`, width));
    lines.push("");

    if (logPreview !== null) {
      lines.push(truncateToWidth(th.fg("borderMuted", "─".repeat(width)), width));
      lines.push(truncateToWidth(th.fg("accent", " Log tail (last 100 lines) — press ↑/↓ to dismiss "), width));
      lines.push("");
      for (const line of logPreview.split("\n").slice(-100)) {
        lines.push(truncateToWidth(th.fg("dim", line), width));
      }
      lines.push("");
    }

    cachedWidth = width;
    cachedLines = lines;
    return lines;
  }

  return { handleInput, render };
}
