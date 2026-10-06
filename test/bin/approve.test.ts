import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/core/logger.js';
import { createRedactor } from '../../src/core/redactor.js';
import { AdminChannel } from '../../src/guardrails/admin-channel.js';
import {
  discoverServers,
  escapeForDisplay,
  formatPending,
  requestServer,
  runApprove,
  type Terminal,
} from '../../src/guardrails/admin-client.js';
import { createAdminFixture, type AdminFixture } from '../support/admin.js';

const inputs = { repo: 'sample-node-api', jobId: 'job-1001-1' };
let fixture: AdminFixture;
beforeEach(async () => {
  fixture = await createAdminFixture();
});
afterEach(async () => {
  await fixture.cleanup();
});

function scriptedTerminal(...answers: string[]): { terminal: Terminal; questions: string[] } {
  const questions: string[] = [];
  const queue = [...answers];
  return {
    questions,
    terminal: {
      ask: (question) => {
        questions.push(question);
        return Promise.resolve(queue.shift() ?? '');
      },
    },
  };
}

async function run(terminal: Terminal | undefined, ref?: string) {
  const output: string[] = [];
  const code = await runApprove({
    dir: fixture.dir,
    terminal,
    print: (text) => output.push(text),
    ...(ref === undefined ? {} : { ref }),
  });
  return { code, output: output.join('\n') };
}

/** Starts a process that opens a socket and is then killed, leaving a stale socket file. */
async function leaveStaleSocket(path: string): Promise<void> {
  const child = spawn(process.execPath, [
    '-e',
    `require('node:net').createServer().listen(${JSON.stringify(path)}, () => console.log('up'))`,
  ]);
  await new Promise<void>((resolve) => {
    child.stdout.once('data', () => {
      resolve();
    });
  });
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });
  child.kill('SIGKILL');
  await exited;
}

describe('Given text from an agent is shown to the human', () => {
  it('When it holds control, invisible or direction-changing characters, then they are shown as escapes', () => {
    expect(escapeForDisplay('a\u001b[31mb\nc\u007f‮d​e')).toBe(
      'a\\x1b[31mb\\x0ac\\x7f\\u202ed\\u200be',
    );
  });

  it('When a request is formatted, then inputs are JSON-escaped and the digest is shown', () => {
    const text = formatPending({
      requestId: 'req_aaaaaaaaaaaaaaaaaaaaaaaaab',
      tool: 'rerun_ci_job',
      client: 'alice\u001b',
      inputs: { jobId: 'x\ny' },
      digest: 'sha256:0123456789ab',
      createdAt: Date.UTC(2026, 9, 5, 12, 0, 0),
      expiresAt: Date.UTC(2026, 9, 5, 12, 5, 0),
    });
    expect(text).toContain('Inputs:   {"jobId":"x\\ny"}');
    expect(text).toContain('Client:   alice\\x1b');
    expect(text).toContain('Digest:   sha256:0123456789ab');
    expect(text).toContain('Expires:  2026-10-05T12:05:00.000Z');
  });
});

describe('Given the approve command', () => {
  it('When there is no terminal, then it refuses without contacting a server', async () => {
    await fixture.channel({ pid: 7001 }).start();
    const request = fixture.approvals.request('rerun_ci_job', 'alice', inputs);
    const { code, output } = await run(undefined);
    expect(code).toBe(1);
    expect(output).toContain('needs a terminal');
    expect(fixture.approvals.listPending()).toHaveLength(1);
    expect(
      fixture.approvals.claim(request.requestId, 'rerun_ci_job', 'alice', inputs),
    ).toMatchObject({
      reason: 'not_approved',
    });
  });

  it('When no server is running, then it says so', async () => {
    const { code, output } = await run(scriptedTerminal().terminal);
    expect(code).toBe(1);
    expect(output).toContain('No running guardrails server');
  });

  it('When a server has nothing pending, then it says so and succeeds', async () => {
    await fixture.channel({ pid: 7002 }).start();
    const { code, output } = await run(scriptedTerminal().terminal);
    expect(code).toBe(0);
    expect(output).toContain('No pending approvals');
  });

  it('When the human types yes for the only pending request, then it is approved and can be claimed once', async () => {
    await fixture.channel({ pid: 7003 }).start();
    const request = fixture.approvals.request('rerun_ci_job', 'alice', inputs);
    const { terminal, questions } = scriptedTerminal('yes');
    const { code, output } = await run(terminal);
    expect(code).toBe(0);
    expect(output).toContain('rerun_ci_job');
    expect(output).toContain('Approved. Valid until 2026-10-05T12:05:00.000Z');
    expect(questions).toEqual(['Type yes to approve, anything else to cancel: ']);
    expect(fixture.approvals.claim(request.requestId, 'rerun_ci_job', 'alice', inputs)).toEqual({
      ok: true,
    });
  });

  it.each(['no', '', 'y', 'YES', 'yes please'])(
    'When the human answers %j, then nothing is approved',
    async (answer) => {
      await fixture.channel({ pid: 7004 }).start();
      const request = fixture.approvals.request('rerun_ci_job', 'alice', inputs);
      const { code, output } = await run(scriptedTerminal(answer).terminal);
      expect(code).toBe(1);
      expect(output).toContain('Not approved.');
      expect(
        fixture.approvals.claim(request.requestId, 'rerun_ci_job', 'alice', inputs),
      ).toMatchObject({
        reason: 'not_approved',
      });
    },
  );

  it('When a reference is given, then it goes straight to that request without a list', async () => {
    await fixture.channel({ pid: 7005 }).start();
    fixture.approvals.request('rerun_ci_job', 'alice', { ...inputs, jobId: 'a' });
    const wanted = fixture.approvals.request('rerun_ci_job', 'alice', { ...inputs, jobId: 'b' });
    const { terminal, questions } = scriptedTerminal('yes');
    const { code } = await run(terminal, wanted.requestId);
    expect(code).toBe(0);
    expect(questions).toHaveLength(1);
    expect(fixture.approvals.listPending().map((view) => view.inputs)).toEqual([
      { ...inputs, jobId: 'a' },
    ]);
  });

  it('When the reference is unknown, then it says so and approves nothing', async () => {
    await fixture.channel({ pid: 7006 }).start();
    const { code, output } = await run(scriptedTerminal().terminal, 'req_zz\u001b');
    expect(code).toBe(1);
    expect(output).toContain('No pending request req_zz\\x1b');
  });

  it('When several requests are pending, then the human picks one by number', async () => {
    await fixture.channel({ pid: 7007 }).start();
    fixture.approvals.request('rerun_ci_job', 'alice', { ...inputs, jobId: 'a' });
    fixture.approvals.request('rerun_ci_job', 'bob', { ...inputs, jobId: 'b' });
    const { code, output } = await run(scriptedTerminal('2', 'yes').terminal);
    expect(code).toBe(0);
    expect(output).toContain('1. rerun_ci_job for alice');
    expect(output).toContain('2. rerun_ci_job for bob');
    expect(output).toContain('Client:   bob');
  });

  it.each(['0', '9', 'abc', '1.5'])(
    'When the choice is %j, then nothing is approved',
    async (choice) => {
      await fixture.channel({ pid: 7008 }).start();
      fixture.approvals.request('rerun_ci_job', 'alice', { ...inputs, jobId: 'a' });
      fixture.approvals.request('rerun_ci_job', 'bob', { ...inputs, jobId: 'b' });
      const { code, output } = await run(scriptedTerminal(choice).terminal);
      expect(code).toBe(1);
      expect(output).toContain('not one of the choices');
      expect(fixture.approvals.listPending()).toHaveLength(2);
    },
  );

  describe('And two servers are running', () => {
    let second: AdminFixture;
    let other: AdminChannel;
    beforeEach(async () => {
      second = await createAdminFixture();
      await fixture.channel({ pid: 7009 }).start();
      other = new AdminChannel({
        dir: fixture.dir,
        approvals: second.approvals,
        logger: createLogger({
          sink: () => undefined,
          clock: fixture.clock,
          redactor: createRedactor(),
          level: 'error',
          component: 'Other',
        }),
        clock: fixture.clock,
        info: { mode: 'http', auditPath: '/tmp/other.jsonl' },
        pid: 7010,
        isAlive: () => true,
      });
      await other.start();
      second.approvals.request('rerun_ci_job', 'carol', inputs);
    });
    afterEach(async () => {
      await other.stop();
      await second.cleanup();
    });

    it('When the command runs, then the servers are listed and the human chooses one', async () => {
      const { code, output } = await run(scriptedTerminal('2', 'yes').terminal);
      expect(output).toContain('1. pid 7009, stdio mode');
      expect(output).toContain('2. pid 7010, http mode');
      expect(output).toContain('Client:   carol');
      expect(code).toBe(0);
    });

    it('When the human picks a server that does not exist, then nothing is approved', async () => {
      const { code, output } = await run(scriptedTerminal('7').terminal);
      expect(code).toBe(1);
      expect(output).toContain('not one of the choices');
      expect(second.approvals.listPending()).toHaveLength(1);
    });
  });

  it('When the request expires before the human confirms, then approval is refused', async () => {
    await fixture.channel({ pid: 7011 }).start();
    const request = fixture.approvals.request('rerun_ci_job', 'alice', inputs);
    const terminal: Terminal = {
      ask: () => {
        fixture.clock.tick(5 * 60 * 1000 + 1);
        return Promise.resolve('yes');
      },
    };
    const { code, output } = await run(terminal, request.requestId);
    expect(code).toBe(1);
    expect(output).toContain('Not approved: expired.');
  });
});

describe('Given sockets are found in the socket folder', () => {
  it('When the folder does not exist, then no servers are found', async () => {
    expect(await discoverServers(join(fixture.root, 'nothing'))).toEqual([]);
  });

  it('When a socket belongs to a crashed process, then it is deleted and not listed', async () => {
    await mkdir(fixture.dir, { recursive: true, mode: 0o700 });
    const stale = join(fixture.dir, '9999.sock');
    await leaveStaleSocket(stale);
    expect((await stat(stale)).isSocket()).toBe(true);
    expect(await discoverServers(fixture.dir)).toEqual([]);
    expect(await readdir(fixture.dir)).toEqual([]);
  });

  it('When a socket answers with nothing, then it is skipped but not deleted', async () => {
    await mkdir(fixture.dir, { recursive: true, mode: 0o700 });
    const silent = createServer((socket) => {
      socket.end();
    });
    const path = join(fixture.dir, '9998.sock');
    await new Promise<void>((resolve) => silent.listen(path, resolve));
    try {
      expect(await discoverServers(fixture.dir)).toEqual([]);
      expect((await stat(path)).isSocket()).toBe(true);
    } finally {
      silent.close();
    }
  });

  it('When a file in the folder is not a socket name, then it is ignored', async () => {
    await mkdir(fixture.dir, { recursive: true, mode: 0o700 });
    await writeFile(join(fixture.dir, 'readme.txt'), '');
    expect(await discoverServers(fixture.dir)).toEqual([]);
  });

  it('When the reply is not valid JSON, then the request fails instead of crashing', async () => {
    await mkdir(fixture.dir, { recursive: true, mode: 0o700 });
    const path = join(fixture.dir, '9997.sock');
    const garbled = createServer((socket) => {
      socket.once('data', () => {
        socket.write('garbage\n');
      });
    });
    await new Promise<void>((resolve) => garbled.listen(path, resolve));
    try {
      await expect(requestServer(path, { op: 'info' })).rejects.toThrow();
    } finally {
      garbled.close();
    }
  });

  it('When a request is sent to a missing socket, then the error is raised', async () => {
    await expect(requestServer(join(fixture.root, 'none.sock'), { op: 'info' })).rejects.toThrow();
  });
});
