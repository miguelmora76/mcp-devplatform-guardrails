import { chmod, mkdir, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestServer } from '../../src/guardrails/admin-client.js';
import type { AdminChannel } from '../../src/guardrails/admin-channel.js';
import {
  prepareSocketDirectory,
  UnsafeSocketDirectoryError,
} from '../../src/guardrails/admin-channel.js';
import { createAdminFixture, type AdminFixture } from '../support/admin.js';

const inputs = { repo: 'sample-node-api', jobId: 'job-1001-1' };
let fixture: AdminFixture;
beforeEach(async () => {
  fixture = await createAdminFixture();
});
afterEach(async () => {
  await fixture.cleanup();
});

/** Sends raw text to the socket and returns what comes back until the server closes it. */
function rawExchange(path: string, text: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      received += chunk;
      if (received.endsWith('\n')) socket.end();
    });
    socket.on('close', () => resolve(received));
    // A server that drops the connection may reset it while we are still writing.
    socket.on('error', () => resolve(received));
    socket.write(text);
  });
}

describe('Given the socket directory', () => {
  it('When it does not exist, then it is created readable by the owner only', async () => {
    await prepareSocketDirectory(fixture.dir, process.getuid?.() ?? 0);
    expect((await stat(fixture.dir)).mode & 0o777).toBe(0o700);
  });

  it('When it already exists with group or world access, then the server refuses to start', async () => {
    await mkdir(fixture.dir, { recursive: true });
    await chmod(fixture.dir, 0o755);
    await expect(fixture.channel().start()).rejects.toBeInstanceOf(UnsafeSocketDirectoryError);
  });

  it('When it is owned by someone else, then the server refuses to start', async () => {
    await expect(fixture.channel({ uid: 4_000_000 }).start()).rejects.toThrow(/owned/);
  });

  it('When it is a symbolic link, then the server refuses to start', async () => {
    await mkdir(join(fixture.root, 'real'), { mode: 0o700 });
    await symlink(join(fixture.root, 'real'), fixture.dir);
    await expect(fixture.channel().start()).rejects.toThrow(/folder/);
  });
});

describe('Given a running admin channel', () => {
  it('When it starts, then a socket named after the process exists with owner-only access', async () => {
    const channel = fixture.channel({ pid: 4242 });
    await channel.start();
    const info = await stat(join(fixture.dir, '4242.sock'));
    expect(info.isSocket()).toBe(true);
    expect(info.mode & 0o077).toBe(0);
  });

  it('When it stops, then its socket is removed', async () => {
    const channel = fixture.channel({ pid: 4243 });
    await channel.start();
    await channel.stop();
    expect(await readdir(fixture.dir)).toEqual([]);
  });

  it('When stop is called without a start, then nothing happens', async () => {
    await expect(fixture.channel().stop()).resolves.toBeUndefined();
  });

  it('When a leftover socket of its own process ID exists, then it is replaced', async () => {
    await mkdir(fixture.dir, { recursive: true, mode: 0o700 });
    await writeFile(join(fixture.dir, '4244.sock'), '');
    await fixture.channel({ pid: 4244 }).start();
    expect((await stat(join(fixture.dir, '4244.sock'))).isSocket()).toBe(true);
  });

  it('When sockets of dead processes are present at start, then they are removed and live ones kept', async () => {
    await mkdir(fixture.dir, { recursive: true, mode: 0o700 });
    await writeFile(join(fixture.dir, '111.sock'), '');
    await writeFile(join(fixture.dir, '222.sock'), '');
    await writeFile(join(fixture.dir, 'notes.txt'), '');
    await fixture.channel({ pid: 333, isAlive: (pid) => pid === 222 }).start();
    expect((await readdir(fixture.dir)).sort()).toEqual(['222.sock', '333.sock', 'notes.txt']);
  });

  it('When asked for info, then it reports its process, mode, audit file and start time', async () => {
    await fixture.channel({ pid: 4245 }).start();
    const reply = await requestServer(join(fixture.dir, '4245.sock'), { op: 'info' });
    expect(reply).toEqual({
      ok: true,
      pid: 4245,
      mode: 'stdio',
      auditPath: '/tmp/audit.jsonl',
      startedAt: '2026-10-05T12:00:00.000Z',
    });
  });

  it('When asked to list, then it returns pending requests with their exact inputs and digest', async () => {
    await fixture.channel({ pid: 4246 }).start();
    const request = fixture.approvals.request('rerun_ci_job', 'alice', inputs);
    const reply = await requestServer(join(fixture.dir, '4246.sock'), { op: 'list' });
    expect(reply).toMatchObject({
      ok: true,
      pending: [
        {
          requestId: request.requestId,
          tool: 'rerun_ci_job',
          client: 'alice',
          inputs,
          digest: request.displayDigest,
        },
      ],
    });
  });

  it('When asked to approve a pending request, then it becomes approved and the answer says until when', async () => {
    await fixture.channel({ pid: 4247 }).start();
    const request = fixture.approvals.request('rerun_ci_job', 'alice', inputs);
    const reply = await requestServer(join(fixture.dir, '4247.sock'), {
      op: 'approve',
      requestId: request.requestId,
    });
    expect(reply).toEqual({
      ok: true,
      requestId: request.requestId,
      validUntil: '2026-10-05T12:05:00.000Z',
    });
    expect(fixture.approvals.claim(request.requestId, 'rerun_ci_job', 'alice', inputs)).toEqual({
      ok: true,
    });
  });

  it('When asked to approve an unknown request, then it refuses and logs the refusal', async () => {
    await fixture.channel({ pid: 4248 }).start();
    const reply = await requestServer(join(fixture.dir, '4248.sock'), {
      op: 'approve',
      requestId: 'req_aaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(reply).toEqual({ ok: false, reason: 'unknown' });
    expect(fixture.logLines.join('\n')).toContain('approve.refused');
  });

  it('When the request is malformed, then it answers with an error and keeps serving', async () => {
    await fixture.channel({ pid: 4249 }).start();
    const socket = join(fixture.dir, '4249.sock');
    expect(await rawExchange(socket, 'not json\n')).toBe('{"ok":false,"reason":"bad_request"}\n');
    expect(await rawExchange(socket, '{"op":"approve"}\n')).toBe(
      '{"ok":false,"reason":"bad_request"}\n',
    );
    expect(await rawExchange(socket, '{"op":"launch"}\n')).toBe(
      '{"ok":false,"reason":"unknown_op"}\n',
    );
    expect(await rawExchange(socket, '42\n')).toBe('{"ok":false,"reason":"bad_request"}\n');
    expect(await rawExchange(socket, 'null\n')).toBe('{"ok":false,"reason":"bad_request"}\n');
    expect(await requestServer(socket, { op: 'info' })).toMatchObject({ ok: true });
  });

  it('When one connection sends an oversized line, then that connection is dropped', async () => {
    await fixture.channel({ pid: 4250 }).start();
    const socket = join(fixture.dir, '4250.sock');
    expect(await rawExchange(socket, 'x'.repeat(70_000))).toBe('');
    expect(await requestServer(socket, { op: 'info' })).toMatchObject({ ok: true });
  });

  it('When several servers run, then each has its own socket and approvals are separate', async () => {
    await fixture.channel({ pid: 5001 }).start();
    await fixture.channel({ pid: 5002, isAlive: () => true }).start();
    expect((await readdir(fixture.dir)).sort()).toEqual(['5001.sock', '5002.sock']);
  });

  it('When a connection errors, then the server carries on serving others', async () => {
    const channel = fixture.channel({ pid: 4251 });
    await channel.start();
    const socket = join(fixture.dir, '4251.sock');
    const client = createConnection(socket);
    await new Promise<void>((resolve) => {
      client.once('connect', () => {
        resolve();
      });
    });
    await requestServer(socket, { op: 'info' });
    expect(channel.openConnections.size).toBeGreaterThan(0);
    for (const connection of channel.openConnections) connection.emit('error', new Error('reset'));
    client.destroy();
    expect(await requestServer(socket, { op: 'info' })).toMatchObject({ ok: true });
  });

  it('When the channel is built with the real process ID by default, then the socket carries it', async () => {
    const channel: AdminChannel = fixture.channel();
    await channel.start();
    expect(await readdir(fixture.dir)).toEqual([`${process.pid}.sock`]);
  });
});
