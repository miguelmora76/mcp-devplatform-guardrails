import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { App } from '../app.js';
import { ConfigError, type Config } from '../core/config.js';
import type { Scheduler } from '../core/ports.js';
import { createMcpServer } from './mcp-server.js';
import { FailedLoginQueue } from './failed-login-queue.js';

/**
 * HTTP mode (LC-02), optional. Loopback only; every request must carry a bearer token and
 * a loopback Host (and, if present, a loopback Origin). The token's name is the client
 * identity used for audit and rate limits. Order of checks: connection bound, Host,
 * Origin, token, method and path, body size, then the MCP protocol. Connection-level
 * refusals go to the operational log, never the audit log (NFR1.4, NFR1.9, NFR1.16,
 * NFR1.19).
 */

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_CONNECTIONS = 50;
const LOOPBACK_ADDRESS = '127.0.0.1';
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface HttpOptions {
  readonly config: Config;
  readonly scheduler: Scheduler;
}

export interface RunningHttp {
  readonly address: string;
  readonly port: number;
  readonly failedLogins: FailedLoginQueue;
  /** Open connections right now. */
  readonly connections: number;
  /** Stops accepting new connections and requests; in-flight requests finish. */
  stopAccepting(): Promise<void>;
  /** Closes everything now. */
  close(): Promise<void>;
}

/** HTTP mode needs at least one token. */
export function assertHttpConfigured(config: Config): void {
  if (config.tokens.length === 0) {
    throw new ConfigError('HTTP mode needs GUARDRAILS_TOKENS (name=token, up to 5 clients)');
  }
}

export async function startHttpTransport(app: App, options: HttpOptions): Promise<RunningHttp> {
  assertHttpConfigured(options.config);
  const logger = app.logger.forComponent('HttpListener');
  const failedLogins = new FailedLoginQueue(options.scheduler);
  const tokens = options.config.tokens.map((entry) => ({
    name: entry.name,
    hash: sha256(entry.token),
  }));
  const sockets = new Set<Socket>();
  let port = 0;

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      logger.error('http.error', { err: error instanceof Error ? error.message : 'unknown' });
      if (!res.headersSent) respond(res, 500, { error: 'internal_error' });
      else res.end();
    });
  });

  server.on('connection', (socket) => {
    if (sockets.size >= MAX_CONNECTIONS) {
      logger.warn('http.conn_limit', { limit: MAX_CONNECTIONS, remote: socket.remoteAddress });
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remote = req.socket.remoteAddress;
    if (!hostAllowed(req.headers.host, port)) {
      logger.warn('http.refused', { reason: 'host', remote });
      respond(res, 403, { error: 'forbidden' });
      return;
    }
    if (!originAllowed(req.headers.origin)) {
      logger.warn('http.refused', { reason: 'origin', remote });
      respond(res, 403, { error: 'forbidden' });
      return;
    }

    const client = authenticate(req.headers.authorization);
    if (client === undefined) {
      // A valid token never waits; a failure takes its turn in the one serialised queue.
      if (!(await failedLogins.fail())) {
        logger.warn('http.refused', { reason: 'queue full', remote });
        req.socket.destroy();
        return;
      }
      logger.warn('http.refused', { reason: 'token', remote });
      res.setHeader('WWW-Authenticate', 'Bearer');
      respond(res, 401, { error: 'unauthorized' });
      return;
    }

    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') {
      respond(res, 404, { error: 'not_found' });
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      respond(res, 405, { error: 'method_not_allowed' });
      return;
    }

    const text = await readBody(req);
    if (text === undefined) {
      logger.warn('http.refused', { reason: 'body too large', remote });
      res.setHeader('Connection', 'close');
      respond(res, 413, { error: 'payload_too_large' });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      respond(res, 400, { error: 'invalid_json' });
      return;
    }

    // A fresh, stateless protocol server per request, speaking for this client only.
    const mcp = createMcpServer(app, { name: client });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  /** Constant-time check over every configured token; returns the matching client name. */
  function authenticate(header: string | undefined): string | undefined {
    const presented = sha256(/^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '');
    let match: string | undefined;
    for (const token of tokens) {
      if (timingSafeEqual(presented, token.hash)) match = token.name;
    }
    return match;
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.config.httpPort, LOOPBACK_ADDRESS, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;
  logger.info('server.start', { mode: 'http', address: LOOPBACK_ADDRESS, port });

  return {
    address: LOOPBACK_ADDRESS,
    port,
    failedLogins,
    get connections() {
      return sockets.size;
    },
    stopAccepting: () => stopListening(server),
    async close() {
      for (const socket of sockets) socket.destroy();
      await stopListening(server);
    },
  };
}

function stopListening(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
    server.closeIdleConnections();
  });
}

function sha256(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** No Origin (not a browser) is fine; a present Origin must be a loopback origin. */
function originAllowed(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    return LOOPBACK_NAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Reads the body, stopping as soon as it passes 64 KiB (never truncating). */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function respond(res: ServerResponse, status: number, body: object): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}
