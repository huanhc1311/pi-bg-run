import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface SpawnResult {
  pid: number;
  logPath: string;
  child: ReturnType<typeof spawn>;
}

export function createProcessSpawner() {
  function generateId(): string {
    return `bg_${Math.random().toString(36).slice(2, 10)}`;
  }

  function spawnProcess(command: string, runDir: string): SpawnResult {
    const id = generateId();
    const logPath = path.join(runDir, `${id}.log`);
    let logFd: number;
    try {
      logFd = fs.openSync(logPath, "w");
    } catch (err) {
      throw new Error(`Failed to create log file: ${err}`);
    }
    try {
      const child = spawn("sh", ["-c", command], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
      });
      const pid = child.pid!;
      child.unref();
      fs.closeSync(logFd);
      return { pid, logPath, child };
    } catch (err) {
      fs.closeSync(logFd);
      throw new Error(`Failed to spawn process: ${err}`);
    }
  }

  return { spawn: spawnProcess, generateId };
}
