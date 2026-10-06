import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRedactor } from '../../src/core/redactor.js';
import {
  acquireLock,
  AuditLockedError,
  AuditUnavailableError,
  AuditWriter,
  FileAuditSink,
  isProcessAlive,
  UnavailableAuditSink,
  type AuditEntry,
  type AuditFileHandle,
} from '../../src/guardrails/audit.js';
import { FakeClock, MemoryAuditSink } from '../support/fakes.js';

const DEAD_PID = 2_147_483_000;

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    callId: 'call_aaaaaaaaaaaaaaaaaaaaaaaaab',
    phase: 'complete',
    tool: 'triage_ci_failure',
    client: 'sess_aaaaaaaaaaaaaaaaaaaaaaaaab',
    inputs: { repo: 'sample-node-api' },
    outcome: 'allowed',
    ...overrides,
  };
}

function writerFor(
  sink: MemoryAuditSink | FileAuditSink | UnavailableAuditSink,
  secrets: string[] = [],
) {
  return new AuditWriter({
    sink,
    clock: new FakeClock(Date.UTC(2026, 9, 5, 12, 0, 0)),
    redactor: createRedactor({ secrets }),
  });
}

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gr-audit-'));
});
afterEach(async () => {
  await chmod(directory, 0o700);
  await rm(directory, { recursive: true, force: true });
});

describe('Given the audit writer and a sink', () => {
  it('When a call is recorded, then the line has the documented fields and a stable shape', async () => {
    const sink = new MemoryAuditSink();
    await writerFor(sink).record(entry());
    expect(sink.lines[0]).toBe(
      '{"ts":"2026-10-05T12:00:00.000Z","callId":"call_aaaaaaaaaaaaaaaaaaaaaaaaab","phase":"complete","tool":"triage_ci_failure","client":"sess_aaaaaaaaaaaaaaaaaaaaaaaaab","inputs":{"repo":"sample-node-api"},"outcome":"allowed"}',
    );
  });

  it('When inputs hold a secret, then the secret never reaches the sink', async () => {
    const sink = new MemoryAuditSink();
    const token = 'mgt_TESTconfiguredtokenvalue0123';
    await writerFor(sink, [token]).record(
      entry({
        inputs: { repo: token, authorization: 'Bearer abc', note: `ghp_${'A1b2C3d4E5'.repeat(4)}` },
      }),
    );
    expect(sink.lines[0]).not.toContain(token);
    expect(sink.lines[0]).not.toContain('abc"');
    expect(sink.lines[0]).not.toContain('ghp_');
  });

  it('When inputs are huge, then the line records that they were omitted instead of copying them', async () => {
    const sink = new MemoryAuditSink();
    await writerFor(sink).record(entry({ inputs: { blob: 'ab '.repeat(3000) } }));
    expect(sink.records()[0]?.inputs).toMatchObject({ _omitted: 'input too large' });
  });

  it('When there are no inputs at all, then the line still records the call', async () => {
    const sink = new MemoryAuditSink();
    await writerFor(sink).record(entry({ inputs: undefined }));
    expect(sink.records()).toHaveLength(1);
  });

  it('When a write is recorded as intent then outcome, then both lines share one call ID and only the intent is durable', async () => {
    const sink = new MemoryAuditSink();
    const writer = writerFor(sink);
    await writer.record(entry({ phase: 'intent', outcome: 'pending', tool: 'rerun_ci_job' }));
    await writer.record(entry({ phase: 'outcome', tool: 'rerun_ci_job' }));
    const records = sink.records();
    expect(records.map((r) => r.phase)).toEqual(['intent', 'outcome']);
    expect(new Set(records.map((r) => r.callId)).size).toBe(1);
    expect(sink.durableFlags).toEqual([true, false]);
  });

  it('When one append fails, then that call hears about it and later appends still succeed', async () => {
    const sink = new MemoryAuditSink();
    const writer = writerFor(sink);
    sink.failWith = new Error('disk on fire');
    await expect(writer.record(entry())).rejects.toThrow('disk on fire');
    sink.failWith = undefined;
    await writer.record(entry({ callId: 'call_aaaaaaaaaaaaaaaaaaaaaaaaac' }));
    expect(sink.records().map((r) => r.callId)).toEqual(['call_aaaaaaaaaaaaaaaaaaaaaaaaac']);
  });

  it('When the writer is closed, then queued appends finish first and the sink is closed', async () => {
    const sink = new MemoryAuditSink();
    const writer = writerFor(sink);
    void writer.record(entry());
    await writer.close();
    expect(sink.lines).toHaveLength(1);
    expect(sink.closed).toBe(true);
  });

  it('When the sink has no close step, then closing the writer still works', async () => {
    const lines: string[] = [];
    const writer = new AuditWriter({
      sink: { append: (line) => Promise.resolve(void lines.push(line)) },
      clock: new FakeClock(),
      redactor: createRedactor(),
    });
    await writer.close();
    expect(lines).toEqual([]);
  });
});

describe('Given the audit file', () => {
  it('When 5 clients record in parallel, then every line is complete JSON and no line interleaves', async () => {
    const path = join(directory, 'audit.jsonl');
    const sink = await FileAuditSink.open(path);
    const writer = writerFor(sink);
    const jobs: Promise<void>[] = [];
    for (let client = 0; client < 5; client += 1) {
      for (let call = 0; call < 20; call += 1) {
        jobs.push(
          writer.record(entry({ client: `client${client}`, callId: `call_${client}_${call}` })),
        );
      }
    }
    await Promise.all(jobs);
    await writer.close();
    const lines = (await readFile(path, 'utf8')).split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(100);
    const ids = lines.map((line) => (JSON.parse(line) as { callId: string }).callId);
    expect(new Set(ids).size).toBe(100);
  });

  it('When the audit file is opened in a new folder, then the folder is created and the lock is held until close', async () => {
    const path = join(directory, 'nested', 'audit.jsonl');
    const sink = await FileAuditSink.open(path);
    expect((await stat(`${path}.lock`)).isFile()).toBe(true);
    await sink.close();
    await expect(stat(`${path}.lock`)).rejects.toThrow();
  });

  it('When existing lines are present, then they are never modified, only appended to', async () => {
    const path = join(directory, 'audit.jsonl');
    await writeFile(path, '{"old":1}\n');
    const sink = await FileAuditSink.open(path);
    await sink.append('{"new":2}');
    await sink.close();
    expect(await readFile(path, 'utf8')).toBe('{"old":1}\n{"new":2}\n');
  });

  it('When a crash left a torn last line, then earlier lines stay intact and the next line starts cleanly', async () => {
    const path = join(directory, 'audit.jsonl');
    await writeFile(path, '{"ok":1}\n{"torn":');
    const sink = await FileAuditSink.open(path);
    await sink.append('{"next":3}');
    await sink.close();
    const lines = (await readFile(path, 'utf8')).split('\n').filter((l) => l !== '');
    expect(JSON.parse(lines[0] ?? '')).toEqual({ ok: 1 });
    expect(() => {
      JSON.parse(lines[1] ?? '');
    }).toThrow();
    expect(JSON.parse(lines[2] ?? '')).toEqual({ next: 3 });
  });

  it('When the next line would pass the size cap, then it is refused, nothing is truncated, and the file stays full', async () => {
    const path = join(directory, 'audit.jsonl');
    const sink = await FileAuditSink.open(path, { maxBytes: 50 });
    await sink.append('x'.repeat(30));
    await expect(sink.append('y'.repeat(30))).rejects.toMatchObject({ reason: 'full' });
    await expect(sink.append('z')).rejects.toMatchObject({ reason: 'full' });
    await sink.close();
    expect(await readFile(path, 'utf8')).toBe(`${'x'.repeat(30)}\n`);
  });

  it('When the file is already at the cap at start, then writes are refused from the first call', async () => {
    const path = join(directory, 'audit.jsonl');
    await writeFile(path, 'x'.repeat(60));
    const sink = await FileAuditSink.open(path, { maxBytes: 50 });
    await expect(sink.append('a')).rejects.toBeInstanceOf(AuditUnavailableError);
    await sink.close();
  });

  it('When the file cannot be written, then opening reports it as unwritable and leaves no lock', async () => {
    const path = join(directory, 'audit.jsonl');
    await writeFile(path, '');
    await chmod(path, 0o400);
    await expect(FileAuditSink.open(path)).rejects.toMatchObject({ reason: 'unwritable' });
    await expect(stat(`${path}.lock`)).rejects.toThrow();
  });

  it('When the audit folder cannot be created, then opening reports it as unwritable', async () => {
    const blocker = join(directory, 'blocker');
    await writeFile(blocker, '');
    await expect(FileAuditSink.open(join(blocker, 'audit.jsonl'))).rejects.toMatchObject({
      reason: 'unwritable',
    });
  });

  it('When a write to the file fails part-way, then the call fails, a newline guards the next line, and later appends work', async () => {
    const written: string[] = [];
    let failNext = true;
    let syncs = 0;
    const handle: AuditFileHandle = {
      write: (data) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('ENOSPC'));
        }
        written.push(data);
        return Promise.resolve();
      },
      sync: () => {
        syncs += 1;
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    };
    const sink = new FileAuditSink(handle, 0, { maxBytes: 1000 });
    await expect(sink.append('first')).rejects.toMatchObject({ reason: 'unwritable' });
    await sink.append('second', { durable: true });
    await sink.append('third');
    expect(written).toEqual(['\nsecond\n', 'third\n']);
    expect(syncs).toBe(1);
    await sink.close();
  });

  it('When the sink was told the file starts without a final newline, then the first line is prefixed', async () => {
    const written: string[] = [];
    const handle: AuditFileHandle = {
      write: (data) => Promise.resolve(void written.push(data)),
      sync: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };
    const sink = new FileAuditSink(handle, 0, { maxBytes: 1000, leadingNewline: true });
    await sink.append('a');
    expect(written).toEqual(['\na\n']);
  });

  it('When the sink is unavailable by design, then every append is refused with its reason', async () => {
    const sink = new UnavailableAuditSink('unwritable');
    await expect(sink.append('x')).rejects.toMatchObject({ reason: 'unwritable' });
  });
});

describe('Given the audit lock file', () => {
  it('When a second process starts while the first is alive, then it refuses to start', async () => {
    const path = join(directory, 'audit.jsonl');
    const first = await FileAuditSink.open(path);
    await expect(
      FileAuditSink.open(path, { pid: 424242, isAlive: () => true }),
    ).rejects.toBeInstanceOf(AuditLockedError);
    await first.close();
  });

  it('When the lock belongs to a dead process, then it is replaced and the new owner is recorded', async () => {
    const path = join(directory, 'audit.jsonl');
    await writeFile(`${path}.lock`, String(DEAD_PID));
    const sink = await FileAuditSink.open(path, { pid: 777, isAlive: (pid) => pid === 777 });
    expect(await readFile(`${path}.lock`, 'utf8')).toBe('777');
    await sink.close();
  });

  it('When the lock file is garbage, then it counts as stale and is replaced', async () => {
    const path = join(directory, 'audit.jsonl');
    await writeFile(`${path}.lock`, 'not a pid');
    const sink = await FileAuditSink.open(path, { pid: 778 });
    expect(await readFile(`${path}.lock`, 'utf8')).toBe('778');
    await sink.close();
  });

  it('When two processes start at once over a stale lock, then exactly one wins', async () => {
    const path = join(directory, 'audit.jsonl');
    await writeFile(`${path}.lock`, String(DEAD_PID));
    const alive = (pid: number): boolean => pid === 1111 || pid === 2222;
    const results = await Promise.allSettled([
      FileAuditSink.open(path, { pid: 1111, isAlive: alive }),
      FileAuditSink.open(path, { pid: 2222, isAlive: alive }),
    ]);
    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toBeInstanceOf(AuditLockedError);
    for (const winner of winners) await winner.value.close();
  });

  it('When the lock vanishes between the collision and the read, then creation is retried', async () => {
    const lock = join(directory, 'a.lock');
    await writeFile(lock, String(DEAD_PID));
    const release = await acquireLock(lock, 5, () => false, {
      afterCollision: () => rm(lock, { force: true }),
    });
    expect(await readFile(lock, 'utf8')).toBe('5');
    await release();
  });

  it('When another process removes the stale lock first, then this one carries on and creates its own', async () => {
    const lock = join(directory, 'b.lock');
    await writeFile(lock, String(DEAD_PID));
    const release = await acquireLock(lock, 6, () => false, {
      afterOwnerRead: () => rm(lock, { force: true }),
    });
    expect(await readFile(lock, 'utf8')).toBe('6');
    await release();
  });

  it('When a live lock appears just before the stale one is claimed, then it is handed back, not stolen', async () => {
    const lock = join(directory, 'c.lock');
    await writeFile(lock, String(DEAD_PID));
    await expect(
      acquireLock(lock, 7, () => false, {
        afterOwnerRead: async () => {
          await writeFile(lock, '8');
        },
      }),
    ).rejects.toBeInstanceOf(AuditLockedError);
    expect(await readFile(lock, 'utf8')).toBe('8');
  });

  it('When the stale lock cannot be moved aside, then the underlying error is raised', async () => {
    const lock = join(directory, 'd.lock');
    await writeFile(lock, String(DEAD_PID));
    await mkdir(join(`${lock}.stale-9`, 'inside'), { recursive: true });
    await expect(acquireLock(lock, 9, () => false)).rejects.toThrow();
  });

  it('When the lock path cannot be read, then the underlying error is raised', async () => {
    const lock = join(directory, 'dir.lock');
    await mkdir(lock);
    await expect(acquireLock(lock, 1, () => false)).rejects.toThrow();
  });

  it('When the lock cannot be created at all, then the underlying error is raised', async () => {
    await expect(
      acquireLock(join(directory, 'missing', 'x.lock'), 1, () => false),
    ).rejects.toThrow();
  });

  it('When the lock is released, then only the owner removes it', async () => {
    const lock = join(directory, 'e.lock');
    const release = await acquireLock(lock, 11, () => false);
    await writeFile(lock, '12');
    await release();
    expect(await readFile(lock, 'utf8')).toBe('12');

    const again = await acquireLock(join(directory, 'f.lock'), 13, () => false);
    await rm(join(directory, 'f.lock'));
    await again();
    await expect(stat(join(directory, 'f.lock'))).rejects.toThrow();

    const owned = await acquireLock(join(directory, 'g.lock'), 14, () => false);
    await owned();
    await expect(stat(join(directory, 'g.lock'))).rejects.toThrow();
  });

  it('When process liveness is checked, then this process is alive and an impossible one is not', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(DEAD_PID)).toBe(false);
    // Process 1 exists but is not ours to signal, which still means "alive".
    expect(isProcessAlive(1)).toBe(true);
  });
});
