import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { BgRunUserSettings } from "../../src/types.js";

describe("loadConfig", () => {
  it("returns defaults when no user settings provided", () => {
    const config = loadConfig(undefined, "/tmp/test-session");
    expect(config).toEqual({
      maxConcurrentJobs: 10,
      completedTtlMs: 7 * 24 * 3600_000,
      widgetRefreshMs: 3_000,
      killTimeoutMs: 10_000,
      runDir: "/tmp/test-session",
    });
  });

  it("merges user settings over defaults", () => {
    const user: BgRunUserSettings = { maxConcurrentJobs: 5, killTimeoutMs: 20_000 };
    const config = loadConfig(user, "/tmp/test-session");
    expect(config.maxConcurrentJobs).toBe(5);
    expect(config.killTimeoutMs).toBe(20_000);
    expect(config.completedTtlMs).toBe(7 * 24 * 3600_000);
  });

  it("uses defaults for undefined user settings keys", () => {
    const user: BgRunUserSettings = { completedTtlMs: 60_000 };
    const config = loadConfig(user, "/tmp/test-session");
    expect(config.maxConcurrentJobs).toBe(10);
    expect(config.completedTtlMs).toBe(60_000);
    expect(config.runDir).toBe("/tmp/test-session");
  });
});
