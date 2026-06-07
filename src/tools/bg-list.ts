import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

export function createBgListTool(getManager: (ctx: any) => any) {
  return {
    name: "bg_list",
    label: "Background List",
    description: "List all background jobs with their status and elapsed time.",
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, ctx: any) {
      const manager = getManager(ctx);
      return { content: [{ type: "text" as const, text: manager.list() }], details: {} };
    },
    renderCall(_args: any, theme: any) {
      return new Text(theme.fg("toolTitle", theme.bold("bg_list")), 0, 0);
    },
    renderResult(result: any, _options: any, theme: any) {
      const text = result.content[0];
      const content = text?.type === "text" ? text.text : "No jobs";
      const lines = content.split("\n").slice(0, 6);
      const display = lines.join("\n");
      const truncated = content.split("\n").length > 6;
      return new Text(theme.fg("text", display) + (truncated ? theme.fg("dim", "\n  ...") : ""), 0, 0);
    },
  };
}
