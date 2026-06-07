import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "../../src/types.js";

const mockJobs: Job[] = [
  { id: "bg_abc123", label: "test", command: "echo hi", logPath: "/tmp/bg_abc123.log", pid: 100, status: "running", exitCode: null, startedAt: 1000, endedAt: null },
  { id: "bg_def456", label: "done", command: "ls", logPath: "/tmp/bg_def456.log", pid: 200, status: "completed", exitCode: 0, startedAt: 2000, endedAt: 3000 },
];

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  rmdirSync: vi.fn(),
  rmSync: vi.fn(),
}));

import * as fs from "node:fs";

describe("Persistence", () => {
  let writtenData: string | null = null;

  beforeEach(() => {
    writtenData = null;
    vi.clearAllMocks();
  });

  it("round-trip saves and loads jobs", async () => {
    const { createPersistence } = await import("../../src/core/persistence.js");

    vi.mocked(fs.writeFileSync).mockImplementation((_p: string, data: string) => { writtenData = data; });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => writtenData!);

    const persistence = createPersistence();
    persistence.save(mockJobs, "/tmp/jobs.json");
    expect(writtenData).toBeTruthy();
    const loaded = persistence.load("/tmp/jobs.json");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe("bg_abc123");
  });

  it("returns empty array when sidecar file does not exist", async () => {
    const { createPersistence } = await import("../../src/core/persistence.js");

    vi.mocked(fs.existsSync).mockReturnValue(false);

    const persistence = createPersistence();
    const loaded = persistence.load("/tmp/nonexistent.json");
    expect(loaded).toEqual([]);
  });

  it("returns empty array for corrupted JSON", async () => {
    const { createPersistence } = await import("../../src/core/persistence.js");

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json{{{");

    const persistence = createPersistence();
    const loaded = persistence.load("/tmp/bad.json");
    expect(loaded).toEqual([]);
  });

  it("recovers running jobs — marks dead PIDs as completed", async () => {
    const { createPersistence } = await import("../../src/core/persistence.js");

    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid: number, signal: any) => {
      if (signal === 0 && pid === 100) throw new Error("ESRCH");
      return true;
    });

    const persistence = createPersistence();
    const recovered = persistence.recover(mockJobs);
    const runningJob = recovered.find(j => j.id === "bg_abc123")!;
    expect(runningJob.status).toBe("completed");
    expect(runningJob.exitCode).toBeNull();
    expect(runningJob.endedAt).toBeGreaterThan(0);
    killSpy.mockRestore();
  });

  it("cleanLogs removes stale logs and entries, saves updated jobs.json", async () => {
    const { createPersistence } = await import("../../src/core/persistence.js");

    const oldJob: Job = {
      ...mockJobs[1], status: "completed", endedAt: Date.now() - 100_000,
      logPath: "/tmp/old-log.txt",
    };
    const recentJob: Job = {
      ...mockJobs[1], id: "bg_recent", endedAt: Date.now() - 1000,
      logPath: "/tmp/recent-log.txt",
    };

    const persistence = createPersistence();
    const kept = persistence.cleanLogs([oldJob, recentJob], 10_000, "/tmp/jobs.json");

    expect(fs.unlinkSync).toHaveBeenCalledWith("/tmp/old-log.txt");
    expect(fs.unlinkSync).not.toHaveBeenCalledWith("/tmp/recent-log.txt");
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe("bg_recent");
    expect(fs.writeFileSync).toHaveBeenCalledWith("/tmp/jobs.json", expect.any(String));
  });

  it("cleanDir removes dir when empty", async () => {
    const { createPersistence } = await import("../../src/core/persistence.js");

    vi.mocked(fs.readdirSync).mockReturnValue([]);

    const persistence = createPersistence();
    persistence.cleanDir("/tmp/bg-run/test");

    expect(fs.rmdirSync).toHaveBeenCalledWith("/tmp/bg-run/test");
  });

  it("gc cleans stale entries, removes dir when empty", async () => {
    const { createPersistence } = await import("../../src/core/persistence.js");

    const oldEndedAt = Date.now() - 1_000_000;
    const sidecarData = JSON.stringify({ jobs: [
      { id: "bg_old", label: "old", command: "echo", logPath: "/tmp/bg-run/proj1/bg_old.log",
        pid: 999, status: "completed", exitCode: 0, startedAt: 1000, endedAt: oldEndedAt, notifiedAt: null },
    ] });

    // gc calls: readdirSync → statSync → existsSync (jobs.json) → readFileSync (sidecar)
    // then cleanLogs calls: unlinkSync (log), writeFileSync (updated sidecar)
    // then checks if empty → rmdirSync
    vi.mocked(fs.readdirSync)
      .mockReturnValueOnce(["proj1"])              // gc scan
      .mockReturnValueOnce([]);                     // cleanDir check (dir empty after gc)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true, mtimeMs: oldEndedAt } as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(sidecarData);
    vi.mocked(fs.unlinkSync).mockReturnValue();
    vi.mocked(fs.writeFileSync).mockReturnValue();
    vi.mocked(fs.rmdirSync).mockReturnValue();

    const persistence = createPersistence();
    persistence.gc("/tmp/bg-run", 300_000);

    expect(fs.unlinkSync).toHaveBeenCalledWith("/tmp/bg-run/proj1/bg_old.log");
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/bg-run/proj1/jobs.json",
      expect.stringContaining("[]")
    );
    expect(fs.unlinkSync).toHaveBeenCalledWith("/tmp/bg-run/proj1/jobs.json");
    expect(fs.rmdirSync).toHaveBeenCalledWith("/tmp/bg-run/proj1");
  });

  it("gc skips dirs with running jobs", async () => {
    const { createPersistence } = await import("../../src/core/persistence.js");

    const sidecarData = JSON.stringify({ jobs: [
      { id: "bg_run1", label: "active", command: "sleep 99", logPath: "/tmp/bg-run/proj2/bg_run1.log",
        pid: 12345, status: "running", exitCode: null, startedAt: Date.now(), endedAt: null, notifiedAt: null },
    ] });

    vi.mocked(fs.readdirSync).mockReturnValue(["proj2"]);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true, mtimeMs: Date.now() } as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(sidecarData);

    const persistence = createPersistence();
    persistence.gc("/tmp/bg-run", 300_000);

    expect(fs.unlinkSync).not.toHaveBeenCalled();
    expect(fs.rmSync).not.toHaveBeenCalled();
  });
});
