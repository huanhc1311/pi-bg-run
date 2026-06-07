import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

export const BgRunParams = Type.Object({
  command: Type.String({ description: "Shell command to run in background" }),
  label: Type.Optional(Type.String({ description: "Human-readable label for this job" })),
});

export function createBgRunTool(getManager: (ctx: any) => any) {
  return {
    name: "bg_run",
    label: "Background Run",
    description:
      "Run a shell command in the background. Returns immediately with a job ID and log path. " +
      "You will be automatically notified when the command completes. " +
      "Use bg_list to check status, bg_kill to terminate.",
    promptSnippet: "Run long scripts in background with automatic notification on completion",
    promptGuidelines: [
      "Use bg_run instead of bash for long-running scripts (ML training, backtests, validation, experiments)",
      "After bg_run, you will be automatically notified when the script completes — no need to poll",
      "Use bg_list to check status of running/completed background jobs",
      "Use bg_kill to terminate a running background job",
    ],
    parameters: BgRunParams,
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const manager = getManager(ctx);
      const { job, error } = manager.spawn(params.command, params.label ?? "");
      if (error) throw new Error(error);
      return {
        content: [{ type: "text" as const, text: `✅ Started ${job.id}: "${job.label}"\nCommand: ${job.command}\nLog: ${job.logPath}\nUse bg_list to check status. You'll be notified when it completes.` }],
        details: { jobId: job.id, logPath: job.logPath },
      };
    },
    renderCall(args: any, theme: any) {
      let text = theme.fg("toolTitle", theme.bold("bg_run "));
      if (args.label) text += theme.fg("dim", `"${args.label}"`);
      return new Text(text, 0, 0);
    },
    renderResult(result: any, _options: any, theme: any) {
      const details = result.details as { jobId?: string; logPath?: string } | undefined;
      if (!details?.jobId) return new Text(theme.fg("error", "Failed to start background job"), 0, 0);
      return new Text(theme.fg("success", "✓ ") + theme.fg("accent", details.jobId) + theme.fg("dim", ` → ${details.logPath}`), 0, 0);
    },
  };
}
