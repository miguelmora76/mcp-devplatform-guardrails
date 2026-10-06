import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { App } from '../app.js';
import type { ClientIdentity } from '../core/identity.js';
import type { CallResult } from '../guardrails/wrapper.js';

/**
 * Shared MCP protocol layer for both transports. It lists tools and hands every
 * `tools/call` to the guardrail wrapper; it never invokes a tool handler itself and has
 * no tool, resource or route that can issue an approval.
 */

const SERVER_INFO = { name: 'mcp-devplatform-guardrails', version: '0.1.0' } as const;

export function createMcpServer(app: App, client: ClientIdentity): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: app.registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: { type: 'object' as const, ...tool.inputJsonSchema },
      annotations: { readOnlyHint: tool.kind === 'read' },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await app.wrapper.call(
      client,
      request.params.name,
      request.params.arguments ?? {},
    );
    return toCallToolResult(result);
  });

  return server;
}

function toCallToolResult(result: CallResult): CallToolResult {
  const meta = { callId: result.callId, ...(result.auditFailure ? { auditFailure: true } : {}) };
  if (result.ok) {
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      structuredContent: result.data as Record<string, unknown>,
      _meta: meta,
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(result.error) }],
    structuredContent: { ...result.error },
    _meta: meta,
  };
}
