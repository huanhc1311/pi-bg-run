import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { createProcessSpawner } from "./core/process-spawner.js";
import { createProcessMonitor } from "./core/process-monitor.js";
import { createProcessKiller } from "./core/process-killer.js";
import { createPersistence } from "./core/persistence.js";
import { createJobManager } from "./core/job-manager.js";
import { createNotifier } from "./ui/notifier.js";
import { createWidget } from "./ui/widget.js";
import { createBgRunTool } from "./tools/bg-run.js";
import { createBgListTool } from "./tools/bg-list.js";
import { createBgKillTool } from "./tools/bg-kill.js";
import { createBgPanelComponent } from "./ui/panel.js";

const BASE_RUN_DIR = "/tmp/bg-run";

/** Hash a project path into a short stable directory name */
function hashPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) h = ((h << 5) - h + p.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36); // unsigned base36
}

/** Per-project JobManager registry (keyed by project path hash) */
const projectManagers = new Map<string, ReturnType<typeof createJobManager>>();
/** Track which session uses which project */
const sessionProject = new Map<string, string>();

export default function (pi: ExtensionAPI) {
  function getManager(ctx: any): ReturnType<typeof createJobManager> | undefined {
    const sid = ctx.sessionManager?.getSessionId();
    if (!sid) return undefined;
    const projectKey = sessionProject.get(sid);
    return projectKey ? projectManagers.get(projectKey) : undefined;
  }

  function requireManager(ctx: any): ReturnType<typeof createJobManager> {
    const mgr = getManager(ctx);
    if (!mgr) throw new Error("bg-run: no active session. Start a session first.");
    return mgr;
  }

  // Register tools
  pi.registerTool(createBgRunTool((ctx: any) => requireManager(ctx)));
  pi.registerTool(createBgListTool((ctx: any) => requireManager(ctx)));
  pi.registerTool(createBgKillTool((ctx: any) => requireManager(ctx)));

  // Register /bg command
  pi.registerCommand("bg", {
    description: "Open background jobs panel",
    handler: async (_args: string, ctx: any) => {
      const manager = getManager(ctx);
      if (!manager || !ctx.hasUI) return;
      if (ctx.mode !== "tui") { ctx.ui.notify("/bg requires interactive mode", "error"); return; }
      await ctx.ui.custom<void>((_tui: any, theme: any, _kb: any, done: () => void) => {
        return createBgPanelComponent(
          () => manager.jobs,
          (id: string) => manager.kill(id),
          theme,
          () => done(),
        );
      });
    },
  });

  // Session lifecycle
  pi.on("session_start", async (_event: any, ctx: any) => {
    const sid = ctx.sessionManager?.getSessionId();
    if (!sid) return;

    const cwd = ctx.cwd || process.cwd();
    const projectKey = hashPath(cwd);
    sessionProject.set(sid, projectKey);

    // Reuse existing manager for this project (shared across sessions)
    const existing = projectManagers.get(projectKey);
    if (existing) {
      existing.attach(pi, ctx);
      return;
    }

    const settings = ctx.settings?.bgRun;
    const runDir = path.join(BASE_RUN_DIR, projectKey);
    const config = loadConfig(settings, runDir);

    const spawner = createProcessSpawner();
    const monitor = createProcessMonitor(config.widgetRefreshMs);
    const killer = createProcessKiller(config.killTimeoutMs);
    const persistence = createPersistence();
    const notifier = createNotifier();
    const widget = createWidget(config.completedTtlMs);

    const manager = createJobManager({ spawner, monitor, killer, persistence, notifier, widget, config });
    manager.init(pi, ctx);
    projectManagers.set(projectKey, manager);
  });

  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    const sid = ctx.sessionManager?.getSessionId();
    if (!sid) return;
    const projectKey = sessionProject.get(sid);
    sessionProject.delete(sid);
    if (!projectKey) return;
    const manager = projectManagers.get(projectKey);
    if (manager) {
      manager.detach(ctx);
    }
  });
}
