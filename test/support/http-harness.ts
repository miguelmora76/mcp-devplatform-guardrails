import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type App } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/core/config.js';
import { startHttpTransport, type RunningHttp } from '../../src/transport/http.js';
import { FakeClock, FakeIdSource, FakeRng, FakeScheduler } from './fakes.js';

export const aliceToken = `mgt_TEST${'a'.repeat(40)}`;
export const bobToken = `mgt_TEST${'b'.repeat(40)}`;

export interface HttpResult {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

export interface HttpHarness {
  readonly app: App;
  readonly http: RunningHttp;
  readonly clock: FakeClock;
  readonly scheduler: FakeScheduler;
  readonly logLines: string[];
  readonly auditPath: string;
  readonly config: Config;
  request(options?: RequestOptions): Promise<HttpResult>;
  /** Sends a JSON-RPC call with the given token and returns the parsed response. */
  rpc(token: string | undefined, method: string, params?: object): Promise<HttpResult>;
  auditText(): Promise<string>;
  close(): Promise<void>;
}

export interface RequestOptions {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Send the body in several chunks without a Content-Length. */
  chunks?: Buffer[];
}

export async function startHttpHarness(
  extraEnv: Record<string, string> = {},
): Promise<HttpHarness> {
  const directory = await mkdtemp(join(tmpdir(), 'gr-http-'));
  const auditPath = join(directory, 'audit.jsonl');
  const config = loadConfig({
    GUARDRAILS_AUDIT_PATH: auditPath,
    GUARDRAILS_SOCKET_DIR: join(directory, 'run'),
    GUARDRAILS_TOKENS: `alice=${aliceToken},bob=${bobToken}`,
    GUARDRAILS_HTTP_PORT: '0',
    ...extraEnv,
  });
  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  const logLines: string[] = [];
  const app = await createApp({
    config,
    mode: 'http',
    clock,
    scheduler,
    ids: new FakeIdSource(),
    rng: new FakeRng(),
    logSink: (line) => logLines.push(line),
  });
  const http = await startHttpTransport(app, { config, scheduler });

  const request = (options: RequestOptions = {}): Promise<HttpResult> =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: http.port,
          method: options.method ?? 'POST',
          path: options.path ?? '/mcp',
          headers: options.headers ?? {},
          agent: false,
        },
        (res) => {
          const parts: Buffer[] = [];
          res.on('data', (chunk: Buffer) => parts.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(parts).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      if (options.chunks !== undefined) {
        for (const chunk of options.chunks) req.write(chunk);
        req.end();
      } else {
        req.end(options.body);
      }
    });

  let nextId = 1;
  return {
    app,
    http,
    clock,
    scheduler,
    logLines,
    auditPath,
    config,
    request,
    rpc(token, method, params = {}) {
      const body = JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params });
      return request({
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'content-length': String(Buffer.byteLength(body)),
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body,
      });
    },
    auditText: () => readFile(auditPath, 'utf8').catch(() => ''),
    async close() {
      await http.close();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Waits (using real I/O turns, not timers) until the condition holds. */
export async function until(condition: () => boolean, attempts = 200): Promise<void> {
  for (let i = 0; i < attempts && !condition(); i += 1) {
    await readFile(new URL(import.meta.url));
  }
  if (!condition()) throw new Error('condition not reached');
}
