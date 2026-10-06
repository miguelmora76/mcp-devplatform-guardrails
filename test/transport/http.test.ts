import { createConnection, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/core/config.js';
import { assertHttpConfigured } from '../../src/transport/http.js';
import {
  aliceToken,
  bobToken,
  startHttpHarness,
  until,
  type HttpHarness,
  type HttpResult,
} from '../support/http-harness.js';

let h: HttpHarness;
beforeEach(async () => {
  h = await startHttpHarness();
});
afterEach(async () => {
  await h.close();
});

function structured(result: HttpResult): Record<string, unknown> {
  const rpc = JSON.parse(result.body) as {
    result?: { structuredContent?: Record<string, unknown> };
  };
  return rpc.result?.structuredContent ?? {};
}

function callTool(token: string | undefined, name: string, args: object) {
  return h.rpc(token, 'tools/call', { name, arguments: args });
}

describe('Given the optional HTTP mode', () => {
  describe('When it starts', () => {
    it('Then it listens on the loopback address only', () => {
      expect(h.http.address).toBe('127.0.0.1');
      expect(h.http.port).toBeGreaterThan(0);
    });

    it('Then it refuses to start without any configured token, and more than 5 tokens never reach it', () => {
      expect(() => {
        assertHttpConfigured(loadConfig({}));
      }).toThrow(ConfigError);
      expect(() => {
        loadConfig({
          GUARDRAILS_TOKENS: Array.from(
            { length: 6 },
            (_, i) => `c${i}=mgt_TEST${String(i).repeat(30)}`,
          ).join(','),
        });
      }).toThrow(/at most 5/);
      expect(() => {
        assertHttpConfigured(h.config);
      }).not.toThrow();
    });
  });

  describe('When an authenticated client calls a tool', () => {
    it('Then tools can be listed and called, and the audit identity is the token name', async () => {
      const list = await h.rpc(aliceToken, 'tools/list');
      expect(list.status).toBe(200);
      expect(list.body).toContain('triage_ci_failure');

      const result = await callTool(aliceToken, 'triage_ci_failure', {
        repo: 'sample-node-api',
        runId: 'run-1001',
      });
      expect(structured(result)).toMatchObject({ category: 'test_failure' });
      const records = (await h.auditText())
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { client: string });
      expect(records).toHaveLength(1);
      expect(records[0]?.client).toBe('alice');
    });

    it('Then the token never appears in the audit file or the operational log', async () => {
      await callTool(aliceToken, 'get_ci_job', { repo: 'sample-node-api', jobId: 'job-1001-1' });
      const failed = h.rpc('mgt_wrongwrongwrongwrongwrongwrongwrong', 'tools/list');
      await until(() => h.http.failedLogins.waiting === 1);
      await h.scheduler.advance(200);
      await failed;
      const everything = (await h.auditText()) + h.logLines.join('\n');
      expect(everything).not.toContain(aliceToken);
      expect(everything).not.toContain(bobToken);
      expect(everything).not.toContain('wrongwrongwrong');
    });
  });

  describe('When two clients use two tokens', () => {
    it('Then they have distinct names, audit identities and separate rate limits', async () => {
      const args = { repo: 'sample-node-api', jobId: 'job-1001-1' };
      for (let i = 0; i < 30; i += 1) await callTool(aliceToken, 'get_ci_job', args);
      const limited = await callTool(aliceToken, 'get_ci_job', args);
      expect(structured(limited)).toMatchObject({ code: 'rate_limited' });
      const other = await callTool(bobToken, 'get_ci_job', args);
      expect(structured(other)).toMatchObject({ status: 'failed' });
      const clients = new Set(
        (await h.auditText())
          .trim()
          .split('\n')
          .map((line) => (JSON.parse(line) as { client: string }).client),
      );
      expect(clients).toEqual(new Set(['alice', 'bob']));
    });

    it('Then connections sharing one token share its limits', async () => {
      const args = { repo: 'sample-node-api', jobId: 'job-1001-1' };
      await Promise.all(Array.from({ length: 31 }, () => callTool(aliceToken, 'get_ci_job', args)));
      const records = (await h.auditText())
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { outcome: string });
      expect(records.filter((r) => r.outcome === 'rate-limited')).toHaveLength(1);
    });
  });

  describe('When a request has no token or a wrong token', () => {
    it('Then both get the same refusal, after their turn in the failed-login queue', async () => {
      const missing = h.rpc(undefined, 'tools/list');
      const wrong = h.rpc('mgt_notthetokennotthetokennotthetoken', 'tools/list');
      await until(() => h.http.failedLogins.waiting === 2);
      await h.scheduler.advance(400);
      const [a, b] = await Promise.all([missing, wrong]);
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect(a.body).toBe(b.body);
      expect(a.headers['www-authenticate']).toBe(b.headers['www-authenticate']);
      expect(h.logLines.filter((l) => l.includes('http.refused'))).toHaveLength(2);
      expect(await h.auditText()).toBe('');
    });

    it('Then a malformed Authorization header counts as a failed login too', async () => {
      const bad = h.request({ headers: { authorization: 'Basic abc' }, body: '{}' });
      await until(() => h.http.failedLogins.waiting === 1);
      await h.scheduler.advance(200);
      expect((await bad).status).toBe(401);
    });
  });

  describe('When someone floods failed logins', () => {
    it('Then a valid token is still answered at once and the 21st queued failure is closed', async () => {
      const failures = Array.from({ length: 21 }, () =>
        h.rpc('mgt_attackerattackerattackerattackerattacker', 'tools/list').then(
          (result) => result.status,
          () => 'closed' as const,
        ),
      );
      await until(() => h.http.failedLogins.waiting === 20);
      const valid = await h.rpc(aliceToken, 'tools/list');
      expect(valid.status).toBe(200);

      await h.scheduler.advance(20 * 200);
      const outcomes = await Promise.all(failures);
      expect(outcomes.filter((o) => o === 401)).toHaveLength(20);
      expect(outcomes.filter((o) => o === 'closed')).toHaveLength(1);
      expect(h.logLines.filter((l) => l.includes('queue full'))).toHaveLength(1);
    });
  });

  describe('When the Host or Origin header is not loopback', () => {
    const headers = (extra: Record<string, string>) => ({
      authorization: `Bearer ${aliceToken}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...extra,
    });

    it('Then a foreign Host is refused even with a valid token', async () => {
      const result = await h.request({ headers: headers({ host: 'evil.example:80' }), body: '{}' });
      expect(result.status).toBe(403);
      expect(h.logLines.join('\n')).toContain('host');
    });

    it('Then a foreign Origin is refused even with a valid token', async () => {
      const result = await h.request({
        headers: headers({ origin: 'https://evil.example' }),
        body: '{}',
      });
      expect(result.status).toBe(403);
    });

    it('Then a malformed Origin is refused', async () => {
      const result = await h.request({ headers: headers({ origin: 'not a url' }), body: '{}' });
      expect(result.status).toBe(403);
    });

    it('Then localhost Host and loopback Origin are accepted', async () => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const result = await h.request({
        headers: headers({
          host: `localhost:${h.http.port}`,
          origin: `http://127.0.0.1:${h.http.port}`,
          'content-length': String(body.length),
        }),
        body,
      });
      expect(result.status).toBe(200);
    });

    it('Then a wrong port in Host is refused', async () => {
      const result = await h.request({ headers: headers({ host: '127.0.0.1:1' }), body: '{}' });
      expect(result.status).toBe(403);
    });
  });

  describe('When the connection count passes 50', () => {
    it('Then the extra connection is closed at accept with a logged event', async () => {
      const sockets: Socket[] = [];
      try {
        for (let i = 0; i < 50; i += 1) {
          sockets.push(createConnection({ host: '127.0.0.1', port: h.http.port }));
        }
        await until(() => h.http.connections === 50);
        const extra = createConnection({ host: '127.0.0.1', port: h.http.port });
        sockets.push(extra);
        await new Promise<void>((resolve) => {
          extra.on('close', () => {
            resolve();
          });
          extra.on('error', () => undefined);
        });
        expect(h.logLines.filter((l) => l.includes('http.conn_limit'))).toHaveLength(1);
        expect(h.http.connections).toBe(50);
      } finally {
        for (const socket of sockets) socket.destroy();
      }
    });
  });

  describe('When the request is not acceptable', () => {
    const auth = { authorization: `Bearer ${aliceToken}`, 'content-type': 'application/json' };

    it('Then a body over 64 KiB is refused whether declared or streamed', async () => {
      const big = Buffer.alloc(64 * 1024 + 1, 0x61);
      const declared = await h.request({
        headers: { ...auth, 'content-length': String(big.length) },
        body: big,
      });
      expect(declared.status).toBe(413);
      const streamed = await h.request({
        headers: auth,
        chunks: [big.subarray(0, 40_000), big.subarray(40_000)],
      });
      expect(streamed.status).toBe(413);
    });

    it('Then a body of exactly 64 KiB is still read', async () => {
      const filler = 'x'.repeat(64 * 1024 - 31);
      const body = `{"jsonrpc":"2.0","id":1,"x":"${filler}"}`;
      expect(Buffer.byteLength(body)).toBe(64 * 1024);
      const result = await h.request({
        headers: { ...auth, accept: 'application/json, text/event-stream' },
        body,
      });
      expect(result.status).not.toBe(413);
    });

    it('Then invalid JSON is a 400, a wrong method a 405 and an unknown path a 404', async () => {
      expect((await h.request({ headers: auth, body: '{not json' })).status).toBe(400);
      const get = await h.request({ method: 'GET', headers: auth });
      expect(get.status).toBe(405);
      expect(get.headers.allow).toBe('POST');
      expect((await h.request({ path: '/other', headers: auth, body: '{}' })).status).toBe(404);
    });

    it('Then there is no route that can issue an approval', async () => {
      for (const path of ['/approve', '/approvals', '/admin', '/mcp/approve']) {
        const result = await h.request({ path, headers: auth, body: '{}' });
        expect(result.status).toBe(404);
      }
      expect(h.app.approvals.listPending()).toEqual([]);
    });
  });

  describe('When the server closes', () => {
    it('Then it stops accepting connections', async () => {
      await h.http.close();
      await expect(h.request({ headers: {}, body: '{}' })).rejects.toThrow();
    });
  });
});
