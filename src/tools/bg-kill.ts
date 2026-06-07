import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

export const BgKillParams = Type.Object({
  job_id: Type.String({ description: "Job ID (e.g. bg_abc1)" }),
});

export function createBgKillTool(getManager: (ctx: any) => any) {
  return {
    name: "bg_kill",
    label: "Background Kill",
    description: "Terminate a running background job. Sends SIGTERM, then SIGKILL after 10s if still alive.",
    parameters: BgKillParams,
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const manager = getManager(ctx);
      const { success, message } = manager.kill(params.job_id);
      if (!success) throw new Error(message);
      return { content: [{ type: "text" as const, text: `🔴 ${message}` }], details: { killed: true } };
    },
    renderCall(args: any, theme: any) {
      return new Text(theme.fg("toolTitle", theme.bold("bg_kill ")) + theme.fg("accent", args.job_id), 0, 0);
    },
    renderResult(_result: any, _options: any, theme: any) {
      return new Text(theme.fg("warning", "🔴 ") + theme.fg("muted", "SIGTERM sent"), 0, 0);
    },
  };
}
