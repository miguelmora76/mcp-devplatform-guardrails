import { z } from 'zod';

/**
 * Input validation (LC-05): one strict schema per tool. Unknown fields are rejected,
 * strings are length-capped and free of control characters, and errors list field names
 * only, never the offending value (security-design.md).
 */

export const MAX_STRING_LENGTH = 1024;

// C0 and C1 control characters (including newline, tab and escape) and DEL.

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** A string argument: at most 1024 characters and no control characters. */
export function safeString(maxLength: number = MAX_STRING_LENGTH): z.ZodString {
  return z
    .string()
    .max(maxLength)
    .refine((value) => !CONTROL_CHARACTERS.test(value), { message: 'control characters' });
}

/** A tool's input object. Unknown fields are rejected. */
export function strictObject<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.strictObject(shape);
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fields: readonly string[] };

export function validateInput<T>(schema: z.ZodType<T>, raw: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };

  const fields = new Set<string>();
  for (const issue of parsed.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields.add(safeFieldName(key));
    } else {
      fields.add(issue.path.length === 0 ? '(input)' : safeFieldName(issue.path.join('.')));
    }
  }
  return { ok: false, fields: [...fields].sort() };
}

/** Field names come from the caller, so only plain identifier-like names are echoed back. */
function safeFieldName(name: string): string {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(name) ? name : '(invalid field name)';
}
