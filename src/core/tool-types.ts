import { z } from 'zod';
import type { ClientIdentity } from './identity.js';
import { REQUEST_ID_PATTERN } from './identity.js';
import { strictObject, validateInput, type ValidationResult } from './validator.js';

/**
 * What a tool is, as the registry and the guardrail wrapper see it. A tool declares its
 * kind (read or write) and a strict input shape; the wrapper does everything else
 * (identify, rate limit, validate, approve, audit, execute, error mapping). The only way
 * to make a `Tool` is `defineTool`, which brands it; the registry refuses anything else.
 */

export type ToolKind = 'read' | 'write';

export interface ToolContext {
  readonly callId: string;
  readonly client: ClientIdentity;
}

export type ShapeInput<Shape extends z.ZodRawShape> = z.output<z.ZodObject<Shape>>;

export interface ToolSpec<Shape extends z.ZodRawShape, Output> {
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  /** The tool's own arguments. A write tool also accepts `approvalRequestId`, added for it. */
  readonly shape: Shape;
  readonly handler: (input: ShapeInput<Shape>, context: ToolContext) => Promise<Output>;
  /**
   * Write tools only. Runs after validation and before any approval request exists (and
   * again before a presented approval is claimed). It throws a GuardrailError when the
   * action cannot succeed, so a human is never asked to approve something impossible.
   * It must not change anything.
   */
  readonly precondition?: (input: ShapeInput<Shape>, context: ToolContext) => Promise<void>;
}

/** Validated input bound to its handler, so the wrapper never handles unvalidated data. */
export interface PreparedCall {
  /** The tool's own validated arguments (what an approval is bound to). */
  readonly input: unknown;
  /** The approval the caller presented, for write tools. */
  readonly approvalRequestId: string | undefined;
  /** Resolves when the action could succeed; rejects with a GuardrailError when not. */
  precondition(context: ToolContext): Promise<void>;
  run(context: ToolContext): Promise<unknown>;
}

export const TOOL_BRAND: unique symbol = Symbol('guardrails.tool');

export interface Tool {
  readonly [TOOL_BRAND]: true;
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  readonly inputJsonSchema: Record<string, unknown>;
  prepare(raw: unknown): ValidationResult<PreparedCall>;
}

export const APPROVAL_FIELD = 'approvalRequestId';

export function defineTool<Shape extends z.ZodRawShape, Output>(
  spec: ToolSpec<Shape, Output>,
): Tool {
  if (APPROVAL_FIELD in spec.shape) {
    throw new Error(`${spec.name}: ${APPROVAL_FIELD} is reserved for the approval step`);
  }
  if (spec.precondition !== undefined && spec.kind !== 'write') {
    throw new Error(`${spec.name}: only write tools can declare a precondition`);
  }
  const schema =
    spec.kind === 'write'
      ? strictObject({
          ...spec.shape,
          [APPROVAL_FIELD]: z
            .string()
            .regex(REQUEST_ID_PATTERN)
            .optional()
            .describe(
              'Reference of the human-approved request, from a previous approval_required answer',
            ),
        })
      : strictObject(spec.shape);
  const { $schema: _ignored, ...inputJsonSchema } = z.toJSONSchema(schema) as Record<
    string,
    unknown
  >;
  return {
    [TOOL_BRAND]: true,
    name: spec.name,
    description: spec.description,
    kind: spec.kind,
    inputJsonSchema,
    prepare(raw) {
      const result = validateInput(schema, raw);
      if (!result.ok) return result;
      const { [APPROVAL_FIELD]: approval, ...own } = result.value as Record<string, unknown>;
      const input = own as ShapeInput<Shape>;
      return {
        ok: true,
        value: {
          input,
          approvalRequestId: typeof approval === 'string' ? approval : undefined,
          precondition: (context) => spec.precondition?.(input, context) ?? Promise.resolve(),
          run: (context) => spec.handler(input, context),
        },
      };
    },
  };
}
