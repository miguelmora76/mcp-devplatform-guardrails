/**
 * Finds a JSON-RPC message's own (top-level) request id while the message streams past,
 * without keeping the message. It tracks string, escape and nesting state, so an `"id"`
 * that is nested inside `params`, sits inside a string value, or belongs to an element of
 * a batch is never used. Used only to address the error reply for a message that is too
 * large to parse; the answer is `null` whenever there is no top-level id that is a string
 * (up to 100 characters) or a whole number (up to 15 digits).
 */

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const MAX_KEY_BYTES = 8;
const MAX_ID_BYTES = 100;

type Slot = 'key' | 'colon' | 'value';
type Role = 'none' | 'key' | 'id';

export class IdScanner {
  private depth = 0;
  private isObject = false;
  private slot: Slot = 'key';
  private keyIsId = false;
  private inString = false;
  private escaped = false;
  private role: Role = 'none';
  private collected: number[] = [];
  private overflow = false;
  private numeric: number[] | undefined;
  private done = false;
  private id: string | number | null = null;

  feed(bytes: Uint8Array): void {
    for (const byte of bytes) {
      if (this.done) return;
      if (this.inString) this.inStringByte(byte);
      else this.outsideStringByte(byte);
    }
  }

  /** The top-level id, or null. A number that runs to the end of the input does not count. */
  result(): string | number | null {
    return this.done ? this.id : null;
  }

  private inStringByte(byte: number): void {
    if (this.escaped) {
      this.escaped = false;
      this.collect(byte);
      return;
    }
    if (byte === BACKSLASH) {
      this.escaped = true;
      this.collect(byte);
      return;
    }
    if (byte !== QUOTE) {
      this.collect(byte);
      return;
    }
    this.inString = false;
    if (this.role === 'key') {
      this.keyIsId = !this.overflow && Buffer.from(this.collected).toString('utf8') === 'id';
      this.slot = 'colon';
    } else if (this.role === 'id') {
      this.finish(this.overflow ? null : decodeString(this.collected));
    }
    this.role = 'none';
  }

  private collect(byte: number): void {
    if (this.role === 'none') return;
    if (this.collected.length >= (this.role === 'key' ? MAX_KEY_BYTES : MAX_ID_BYTES + 8)) {
      this.overflow = true;
      return;
    }
    this.collected.push(byte);
  }

  private outsideStringByte(byte: number): void {
    const char = String.fromCharCode(byte);
    if (this.numeric !== undefined) {
      if (/[-+.eE0-9]/.test(char)) {
        this.numeric.push(byte);
        return;
      }
      this.finishNumber();
      if (this.done) return;
    }
    if (/\s/.test(char)) return;

    if (this.depth === 0) {
      if (char === '{' || char === '[') {
        this.depth = 1;
        this.isObject = char === '{';
        this.slot = 'key';
      }
      return;
    }
    if (char === '"') {
      this.startString();
      return;
    }
    if (char === '{' || char === '[') {
      this.noteNonScalarId();
      this.depth += 1;
    } else if (char === '}' || char === ']') {
      this.depth -= 1;
      if (this.depth === 0) this.done = true;
    } else if (this.depth === 1 && this.isObject) {
      this.topLevelPunctuationOrScalar(char, byte);
    }
  }

  private startString(): void {
    this.inString = true;
    this.escaped = false;
    this.collected = [];
    this.overflow = false;
    this.role = 'none';
    if (this.depth !== 1 || !this.isObject) return;
    if (this.slot === 'key') this.role = 'key';
    else if (this.slot === 'value' && this.keyIsId) this.role = 'id';
  }

  /** An object or array as the value of the top-level `id` is not a valid id. */
  private noteNonScalarId(): void {
    if (this.depth === 1 && this.isObject && this.slot === 'value' && this.keyIsId)
      this.finish(null);
  }

  private topLevelPunctuationOrScalar(char: string, byte: number): void {
    if (char === ',') {
      this.slot = 'key';
      this.keyIsId = false;
    } else if (char === ':') {
      this.slot = 'value';
    } else if (this.slot === 'value' && this.keyIsId) {
      if (/[-0-9]/.test(char)) this.numeric = [byte];
      else this.finish(null); // true, false, null and anything else
    }
  }

  private finishNumber(): void {
    const text = Buffer.from(this.numeric ?? []).toString('utf8');
    this.numeric = undefined;
    this.finish(/^-?\d{1,15}$/.test(text) ? Number(text) : null);
  }

  private finish(id: string | number | null): void {
    this.id = id;
    this.done = true;
  }
}

function decodeString(bytes: readonly number[]): string | null {
  try {
    const value: unknown = JSON.parse(`"${Buffer.from(bytes).toString('utf8')}"`);
    return typeof value === 'string' && value.length <= MAX_ID_BYTES ? value : null;
  } catch {
    return null;
  }
}
