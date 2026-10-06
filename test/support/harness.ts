import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createApp, type App } from '../../src/app.js';
import type { Net } from '../../src/core/ports.js';
import { loadConfig, type Config } from '../../src/core/config.js';
import { startStdioTransport, type RunningTransport } from '../../src/transport/stdio.js';
import { FakeClock, FakeIdSource, FakeRng, FakeScheduler } from './fakes.js';
import { StreamClientTransport } from './stream-transport.js';

/** A fully wired server and in-process client with fake time and IDs, and a temp audit file. */
export interface Harness {
  readonly app: App;
  readonly client: Client;
  readonly clock: FakeClock;
  readonly scheduler: FakeScheduler;
  readonly ids: FakeIdSource;
  readonly auditPath: string;
  /** Folder holding the admin socket, for driving the `approve` flow. */
  readonly socketDir: string;
  /** Lines the server wrote to its operational log (standard error). */
  readonly logLines: string[];
  /** The stream a client writes to the server's standard input (for raw, hand-made input). */
  readonly rawInput: PassThrough;
  /** Raw bytes the server wrote to standard output. */
  readonly stdout: string[];
  /** The parsed audit records, in file order. */
  auditRecords(): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

export async function startHarness(
  /** Prepares the temp directory and returns environment overrides (for example a broken audit path). */
  configure: (directory: string) => Promise<Record<string, string>> = () => Promise.resolve({}),
  extra: { net?: Net } = {},
): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), 'guardrails-test-'));
  const env = await configure(directory);
  const auditPath = join(directory, 'audit.jsonl');
  const socketDir = join(directory, 'run');
  const config: Config = loadConfig({
    GUARDRAILS_AUDIT_PATH: auditPath,
    GUARDRAILS_SOCKET_DIR: socketDir,
    ...env,
  });
  const clock = new FakeClock();
  const scheduler = new FakeScheduler(clock);
  const ids = new FakeIdSource();
  const logLines: string[] = [];
  const app = await createApp({
    config,
    mode: 'stdio',
    clock,
    scheduler,
    ids,
    rng: new FakeRng(),
    ...(extra.net === undefined ? {} : { net: extra.net }),
    logSink: (line) => logLines.push(line),
  });

  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const stdout: string[] = [];
  serverToClient.on('data', (chunk: Buffer) => stdout.push(chunk.toString('utf8')));
  const transport: RunningTransport = await startStdioTransport(app, {
    stdin: clientToServer,
    stdout: serverToClient,
  });

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  // Tee the server output so the client still sees it while `stdout` records it.
  const clientInput = new PassThrough();
  serverToClient.pipe(clientInput);
  await client.connect(new StreamClientTransport(clientInput, clientToServer));

  return {
    app,
    client,
    clock,
    scheduler,
    ids,
    auditPath,
    socketDir,
    logLines,
    stdout,
    rawInput: clientToServer,
    async auditRecords() {
      const text = await readFile(auditPath, 'utf8').catch(() => '');
      return text
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    async close() {
      await client.close();
      await transport.close();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
