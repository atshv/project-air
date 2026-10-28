// P6-04 (L00): pure toolbar model. Icons come from packages/ui-kit/icons (served
// by Vite); labels/aria from messages. One primary accent action, groups divided.
export interface ToolDefinition {
  readonly id: "select" | "note" | "zone" | "block" | "connect" | "pan";
  readonly labelKey: string;
  readonly icon: string;
  readonly group: number;
  readonly primary?: boolean;
}
export const TOOLS: readonly ToolDefinition[] = [
  { id: "select", labelKey: "canvas.toolbar.select", icon: "source", group: 0 },
  { id: "note", labelKey: "canvas.toolbar.addNote", icon: "note", group: 0, primary: true },
  { id: "zone", labelKey: "canvas.toolbar.addZone", icon: "zone", group: 1 },
  { id: "block", labelKey: "canvas.toolbar.addChecklist", icon: "checklist", group: 1 },
  { id: "connect", labelKey: "canvas.toolbar.connect", icon: "columns", group: 2 },
  { id: "pan", labelKey: "canvas.toolbar.select", icon: "image", group: 2 },
];
export type ToolId = ToolDefinition["id"];
export function activeToolOrDefault(tool: ToolId | null): ToolId { return tool ?? "select"; }
export function toolGroups(tools: readonly ToolDefinition[] = TOOLS): readonly ToolDefinition[][] {
  const groups: ToolDefinition[][] = [];
  for (const tool of tools) {
    const index = tool.group;
    (groups[index] ??= []).push(tool);
  }
  return groups.map((group) => group ?? []);
}
export function primaryTool(tools: readonly ToolDefinition[] = TOOLS): ToolDefinition | undefined {
  return tools.find((tool) => tool.primary === true);
}
