import { TOOL_BRAND, type Tool } from '../core/tool-types.js';

/**
 * Tool registry (LC-16 wiring): the list of every tool the server offers. Only tools made
 * by `defineTool` are accepted, and the only thing a tool exposes is a validating
 * `prepare`; every call is executed by the guardrail wrapper and nothing else.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: readonly Tool[]) {
    for (const tool of tools) {
      if (tool[TOOL_BRAND] !== true) {
        throw new Error('Only tools made with defineTool can be registered');
      }
      if (this.tools.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
      this.tools.set(tool.name, tool);
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): readonly Tool[] {
    return [...this.tools.values()];
  }
}
