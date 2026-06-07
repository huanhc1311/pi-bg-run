import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));
vi.mock("node:fs", () => ({
  openSync: vi.fn(() => 42),
  closeSync: vi.fn(),
}));

import { spawn } from "node:child_process";
import { createProcessSpawner } from "../../src/core/process-spawner.js";

describe("ProcessSpawner", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("spawns detached process with log file", () => {
    const mockChild = { pid: 12345, unref: vi.fn(), on: vi.fn() };
    vi.mocked(spawn).mockReturnValue(mockChild as any);

    const spawner = createProcessSpawner();
    const result = spawner.spawn("echo hello", "/tmp/run");

    expect(spawn).toHaveBeenCalledWith("sh", ["-c", "echo hello"], {
      detached: true,
      stdio: ["ignore", 42, 42],
    });
    expect(result.pid).toBe(12345);
    expect(result.logPath).toMatch(/\/tmp\/run\/bg_.*\.log/);
    expect(result.child).toBe(mockChild);
    expect(mockChild.unref).not.toHaveBeenCalled();
  });

  it("throws with descriptive error when spawn fails", () => {
    vi.mocked(spawn).mockImplementation(() => { throw new Error("ENOENT"); });
    const spawner = createProcessSpawner();
    expect(() => spawner.spawn("bad command", "/tmp/run")).toThrow("Failed to spawn process: Error: ENOENT");
  });
});
