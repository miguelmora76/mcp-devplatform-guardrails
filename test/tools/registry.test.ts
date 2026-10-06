import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOOL_BRAND, defineTool, type Tool } from '../../src/core/tool-types.js';
import { safeString } from '../../src/core/validator.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { startHarness, type Harness } from '../support/harness.js';

/** Valid arguments for every write tool. A new write tool without an entry fails the spec below. */
const writeToolArguments: Record<string, Record<string, unknown>> = {
  rerun_ci_job: { repo: 'sample-node-api', jobId: 'job-1001-1' },
};

const noop = () => Promise.resolve({});
const readTool = (name: string) =>
  defineTool({ name, description: 'x', kind: 'read', shape: {}, handler: noop });

describe('Given the tool registry', () => {
  it('When a tool is registered twice under one name, then registration fails', () => {
    expect(() => new ToolRegistry([readTool('a'), readTool('a')])).toThrow(/Duplicate/);
  });

  it('When something that was not made by defineTool is registered, then it is refused', () => {
    const unwrapped = {
      name: 'sneaky',
      description: 'x',
      kind: 'write',
      inputJsonSchema: {},
      handler: noop,
      prepare: () => ({ ok: true, value: { input: {}, approvalRequestId: undefined, run: noop } }),
    } as unknown as Tool;
    expect(() => new ToolRegistry([unwrapped])).toThrow(/defineTool/);
  });

  it('When a tool is made with defineTool, then it is branded and listed by name', () => {
    const registry = new ToolRegistry([readTool('a'), readTool('b')]);
    expect(registry.list().map((tool) => tool.name)).toEqual(['a', 'b']);
    expect(registry.get('a')?.[TOOL_BRAND]).toBe(true);
    expect(registry.get('missing')).toBeUndefined();
  });

  it('When a tool declares its own approvalRequestId field, then it is refused as reserved', () => {
    expect(() =>
      defineTool({
        name: 'x',
        description: 'x',
        kind: 'write',
        shape: { approvalRequestId: safeString(10) },
        handler: noop,
      }),
    ).toThrow(/reserved/);
  });

  it('When a read tool declares a precondition, then it is refused because only writes are gated', () => {
    expect(() =>
      defineTool({
        name: 'r',
        description: 'x',
        kind: 'read',
        shape: {},
        precondition: () => Promise.resolve(),
        handler: noop,
      }),
    ).toThrow(/precondition/);
  });

  it('When a write tool is defined, then its input schema accepts the approval reference and a read tool does not', () => {
    const write = defineTool({
      name: 'w',
      description: 'x',
      kind: 'write',
      shape: {},
      handler: noop,
    });
    const read = readTool('r');
    expect(JSON.stringify(write.inputJsonSchema)).toContain('approvalRequestId');
    expect(JSON.stringify(read.inputJsonSchema)).not.toContain('approvalRequestId');
    expect(read.prepare({ approvalRequestId: 'req_aaaaaaaaaaaaaaaaaaaaaaaaaa' }).ok).toBe(false);
  });
});

describe('Given the tools the server really registers', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await startHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  it('When all registered tools are enumerated, then each was made by defineTool and none is named like an approval tool', () => {
    const tools = harness.app.registry.list();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool[TOOL_BRAND]).toBe(true);
      expect(tool.name).not.toMatch(/approv|grant|authori[sz]e|confirm/i);
    }
  });

  it('When the server is asked which tools it offers, then that is exactly the registry, with write tools marked as not read-only', async () => {
    const { tools } = await harness.client.listTools();
    const registry = harness.app.registry.list();
    expect(tools.map((tool) => tool.name)).toEqual(registry.map((tool) => tool.name));
    for (const tool of registry) {
      const offered = tools.find((candidate) => candidate.name === tool.name);
      expect(offered?.annotations?.readOnlyHint).toBe(tool.kind === 'read');
    }
  });

  it('When every write tool is listed, then each has a valid-argument entry in this spec', () => {
    const writes = harness.app.registry.list().filter((tool) => tool.kind === 'write');
    expect(writes.map((tool) => tool.name).sort()).toEqual(Object.keys(writeToolArguments).sort());
  });

  it('When every write tool is called without an approval, then it only asks for one and does not run', async () => {
    for (const [name, args] of Object.entries(writeToolArguments)) {
      const result = await harness.client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ code: 'approval_required' });
    }
    const records = await harness.auditRecords();
    expect(
      records.every((record) => record.phase === 'complete' && record.outcome === 'refused'),
    ).toBe(true);
  });

  it('When every tool is called, then none of them can leave an approved request behind', async () => {
    for (const tool of harness.app.registry.list()) {
      const args = tool.kind === 'write' ? (writeToolArguments[tool.name] ?? {}) : {};
      await harness.client.callTool({ name: tool.name, arguments: args });
    }
    // Approvals only ever come from the human's admin channel: nothing is approved here.
    for (const pending of harness.app.approvals.listPending()) {
      expect(
        harness.app.approvals.claim(
          pending.requestId,
          pending.tool,
          pending.client,
          pending.inputs,
        ),
      ).toMatchObject({ ok: false, reason: 'not_approved' });
    }
  });
});
