import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
      if (signal === 0 && pid === 100) throw new Error("ESRCH"); // dead
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
});
