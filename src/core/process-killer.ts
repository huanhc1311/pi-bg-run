export function createProcessKiller(timeoutMs: number) {
  function sendSignal(pid: number, signal: NodeJS.Signals): boolean {
    try { process.kill(-pid, signal); return true; }
    catch { try { process.kill(pid, signal); return true; } catch { return false; } }
  }

  async function isAlive(pid: number): Promise<boolean> {
    return new Promise((resolve) => {
      const check = () => {
        try { process.kill(pid, 0); resolve(true); } catch { resolve(false); }
      };
      setTimeout(check, 100);
    });
  }

  async function kill(pid: number): Promise<void> {
    sendSignal(pid, "SIGTERM");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await isAlive(pid))) return;
    }
    sendSignal(pid, "SIGKILL");
  }

  return { kill, sendSignal };
}
