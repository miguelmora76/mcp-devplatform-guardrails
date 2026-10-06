import { link, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Clock } from '../core/ports.js';
import type { Redactor } from '../core/redactor.js';

/**
 * Audit writer (LC-09): an append-only JSON-lines record of tool calls.
 *
 * One call has one call ID. A call has one `complete` line, or, for a write that passed
 * every check, an `intent` line (fsynced before the change) then an `outcome` line. Lines
 * are redacted before they are written (FR6.3) and never rewritten. A lock file keeps a
 * second process from writing the same file, and a 100 MiB cap marks the file as not
 * writable instead of dropping or truncating anything (NFR1.12-1.14, NFR1.18, NFR1.20).
 */

export type AuditPhase = 'complete' | 'intent' | 'outcome';
export type AuditOutcome = 'allowed' | 'refused' | 'rate-limited' | 'invalid' | 'error' | 'pending';

export interface AuditEntry {
  readonly callId: string;
  readonly phase: AuditPhase;
  readonly tool: string;
  readonly client: string;
  /** The caller's input as received; redacted and size-capped before it is written. */
  readonly inputs: unknown;
  readonly outcome: AuditOutcome;
}

/** Where audit lines go. One call appends one complete line. */
export interface AuditSink {
  append(line: string, options?: { readonly durable?: boolean }): Promise<void>;
  close?(): Promise<void>;
}

export type AuditUnavailableReason = 'unwritable' | 'full';

/** The audit file cannot take a record; writes must be refused and reads must report it. */
export class AuditUnavailableError extends Error {
  constructor(
    readonly reason: AuditUnavailableReason,
    options?: ErrorOptions,
  ) {
    super(`The audit log is unavailable (${reason}).`, options);
    this.name = 'AuditUnavailableError';
  }
}

/** Another live process holds the audit file's lock; this one must not start. */
export class AuditLockedError extends Error {
  constructor(readonly owner?: number) {
    super('The audit file is locked by another running process.');
    this.name = 'AuditLockedError';
  }
}

/** Inputs larger than this are not copied into the audit line (the call is refused anyway). */
const MAX_AUDITED_INPUT_CHARACTERS = 4096;
export const DEFAULT_MAX_AUDIT_BYTES = 100 * 1024 * 1024;

export interface AuditWriterOptions {
  readonly sink: AuditSink;
  readonly clock: Clock;
  readonly redactor: Redactor;
}

export class AuditWriter {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: AuditWriterOptions) {}

  /**
   * Appends one record. Appends are queued one at a time so lines never interleave; a
   * failed append rejects for its own caller only and never blocks later appends.
   */
  record(entry: AuditEntry): Promise<void> {
    const line = this.encode(entry);
    const durable = entry.phase === 'intent';
    const result = this.tail.then(() => this.options.sink.append(line, { durable }));
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Waits for queued appends, then closes the sink. */
  async close(): Promise<void> {
    await this.tail;
    await this.options.sink.close?.();
  }

  private encode(entry: AuditEntry): string {
    return JSON.stringify({
      ts: new Date(this.options.clock.now()).toISOString(),
      callId: entry.callId,
      phase: entry.phase,
      tool: entry.tool,
      client: entry.client,
      inputs: this.auditedInputs(entry.inputs),
      outcome: entry.outcome,
    });
  }

  private auditedInputs(inputs: unknown): unknown {
    const redacted = this.options.redactor.redact(inputs);
    const size = JSON.stringify(redacted)?.length ?? 0;
    return size > MAX_AUDITED_INPUT_CHARACTERS
      ? { _omitted: 'input too large', characters: size }
      : redacted;
  }
}

/** The part of a file handle the sink needs (replaceable in tests). */
export interface AuditFileHandle {
  write(data: string): Promise<unknown>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface FileAuditSinkOptions {
  readonly maxBytes?: number;
  /** The file did not end in a newline (a torn last line): start the next line cleanly. */
  readonly leadingNewline?: boolean;
  /** Called after the file handle is closed, to release the lock. */
  readonly release?: () => Promise<void>;
}

export interface OpenAuditFileOptions {
  readonly maxBytes?: number;
  readonly pid?: number;
  readonly isAlive?: (pid: number) => boolean;
  readonly lockHooks?: LockHooks;
}

/** Append-only audit file: each line is one `write` of one complete line. */
export class FileAuditSink implements AuditSink {
  private size: number;
  private readonly maxBytes: number;
  private dirty: boolean;
  private full = false;

  constructor(
    private readonly handle: AuditFileHandle,
    initialSize: number,
    private readonly options: FileAuditSinkOptions = {},
  ) {
    this.size = initialSize;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_AUDIT_BYTES;
    this.dirty = options.leadingNewline === true;
    this.full = initialSize > this.maxBytes;
  }

  /**
   * Takes the lock, opens the file for appending and checks its tail. Throws
   * AuditLockedError when another live process holds the lock, or AuditUnavailableError
   * when the file or its folder cannot be used.
   */
  static async open(path: string, options: OpenAuditFileOptions = {}): Promise<FileAuditSink> {
    let release: (() => Promise<void>) | undefined;
    try {
      await mkdir(dirname(path), { recursive: true });
      release = await acquireLock(
        `${path}.lock`,
        options.pid ?? process.pid,
        options.isAlive ?? isProcessAlive,
        options.lockHooks,
      );
      const handle = await open(path, 'a+');
      const { size } = await handle.stat();
      let leadingNewline = false;
      if (size > 0) {
        const last = Buffer.alloc(1);
        await handle.read(last, 0, 1, size - 1);
        leadingNewline = last[0] !== 0x0a;
      }
      return new FileAuditSink(handle, size, {
        ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
        leadingNewline,
        release,
      });
    } catch (error) {
      await release?.();
      if (error instanceof AuditLockedError) throw error;
      throw new AuditUnavailableError('unwritable', { cause: error });
    }
  }

  async append(line: string, options: { readonly durable?: boolean } = {}): Promise<void> {
    if (this.full) throw new AuditUnavailableError('full');
    const data = `${this.dirty ? '\n' : ''}${line}\n`;
    const bytes = Buffer.byteLength(data);
    if (this.size + bytes > this.maxBytes) {
      this.full = true;
      throw new AuditUnavailableError('full');
    }
    try {
      await this.handle.write(data);
      if (options.durable === true) await this.handle.sync();
    } catch (error) {
      // The failed write may have left a partial line; start the next one on a new line.
      this.dirty = true;
      throw new AuditUnavailableError('unwritable', { cause: error });
    }
    this.dirty = false;
    this.size += bytes;
  }

  async close(): Promise<void> {
    await this.handle.close();
    await this.options.release?.();
  }
}

/** Stands in for the file when it cannot be opened: every write is refused with the reason. */
export class UnavailableAuditSink implements AuditSink {
  constructor(private readonly reason: AuditUnavailableReason) {}

  append(_line: string): Promise<void> {
    return Promise.reject(new AuditUnavailableError(this.reason));
  }
}

/** True when a process with this ID exists (EPERM means it exists but is not ours). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Test seams that run at the two points where another process could interfere. */
export interface LockHooks {
  /** After the lock file was found to exist, before its owner is read. */
  readonly afterCollision?: () => Promise<void>;
  /** After a dead owner was seen, before the stale lock is claimed. */
  readonly afterOwnerRead?: () => Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * Lock file: created exclusively and holding the owner's process ID. A lock whose owner
 * is gone is claimed by renaming it aside (atomic, so only one starter can win) and then
 * creating a fresh one; if what was renamed turns out not to be the stale lock that was
 * judged dead, it is handed back and this process refuses to start.
 */
export async function acquireLock(
  lockPath: string,
  pid: number,
  isAlive: (pid: number) => boolean,
  hooks: LockHooks = {},
): Promise<() => Promise<void>> {
  // Each pass either creates the lock, throws, or removes a stale lock, so it terminates.
  for (;;) {
    try {
      await writeFile(lockPath, String(pid), { flag: 'wx' });
      return () => releaseLock(lockPath, pid);
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    await hooks.afterCollision?.();
    const content = await readLockContent(lockPath);
    if (content === undefined) continue;
    const owner = Number.parseInt(content, 10);
    if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) throw new AuditLockedError(owner);

    await hooks.afterOwnerRead?.();
    const claimed = `${lockPath}.stale-${pid}`;
    try {
      await rename(lockPath, claimed);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      continue;
    }
    const taken = await readFile(claimed, 'utf8');
    if (taken !== content) {
      await link(claimed, lockPath);
      await rm(claimed, { force: true });
      throw new AuditLockedError();
    }
    await rm(claimed, { force: true });
  }
}

async function readLockContent(lockPath: string): Promise<string | undefined> {
  try {
    return await readFile(lockPath, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

async function releaseLock(lockPath: string, pid: number): Promise<void> {
  try {
    if ((await readFile(lockPath, 'utf8')) === String(pid)) await rm(lockPath, { force: true });
  } catch {
    // The lock is already gone; nothing to release.
  }
}
