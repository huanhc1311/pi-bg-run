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

/** Per-session JobManager registry */
const sessionManagers = new Map<string, ReturnType<typeof createJobManager>>();

export default function (pi: ExtensionAPI) {
  function getManager(ctx: any): ReturnType<typeof createJobManager> | undefined {
    const sid = ctx.sessionManager?.getSessionId();
    return sid ? sessionManagers.get(sid) : undefined;
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

    const prev = sessionManagers.get(sid);
    if (prev) prev.shutdown();

    const settings = ctx.settings?.bgRun;
    const runDir = path.join(BASE_RUN_DIR, sid);
    const config = loadConfig(settings, runDir);

    const spawner = createProcessSpawner();
    const monitor = createProcessMonitor(config.widgetRefreshMs);
    const killer = createProcessKiller(config.killTimeoutMs);
    const persistence = createPersistence();
    const notifier = createNotifier();
    const widget = createWidget(config.completedTtlMs);

    const manager = createJobManager({ spawner, monitor, killer, persistence, notifier, widget, config });
    manager.init(pi, ctx);
    sessionManagers.set(sid, manager);
  });

  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    const sid = ctx.sessionManager?.getSessionId();
    if (!sid) return;
    const manager = sessionManagers.get(sid);
    if (manager) {
      manager.shutdown();
      sessionManagers.delete(sid);
    }
  });
}
