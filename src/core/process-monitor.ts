export function createProcessMonitor(pollIntervalMs: number) {
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  function watch(jobId: string, pid: number, onExit: () => void): () => void {
    let fired = false;
    const timer = setInterval(() => {
      try {
        process.kill(pid, 0);
      } catch {
        if (!fired) {
          fired = true;
          clear(jobId);
          onExit();
        }
      }
    }, pollIntervalMs);
    timers.set(jobId, timer);
    return () => clear(jobId);
  }

  function clear(jobId: string) {
    const timer = timers.get(jobId);
    if (timer) { clearInterval(timer); timers.delete(jobId); }
  }

  function clearAll() {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
  }

  return { watch, clear, clearAll };
}
