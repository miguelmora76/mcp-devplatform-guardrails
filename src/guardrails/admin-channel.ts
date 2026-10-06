import { chmod, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import type { Logger } from '../core/logger.js';
import type { Clock } from '../core/ports.js';
import type { ApprovalService } from './approval.js';
import { isProcessAlive } from './audit.js';

/**
 * Admin channel (LC-08): the only way an approval is granted. A per-process Unix socket
 * in a per-user folder (mode 0700) lets the separate `approve` command, run by a human in
 * a terminal, list pending requests and approve one. It is not an MCP tool and not an
 * HTTP route, and nothing on it prints a secret (NFR1.3).
 *
 * Protocol: one JSON object per line in, one JSON object per line out.
 *   {op:"info"}                      -> {ok, pid, mode, auditPath, startedAt}
 *   {op:"list"}                      -> {ok, pending:[PendingView]}
 *   {op:"approve", requestId}        -> {ok, requestId, validUntil} | {ok:false, reason}
 */

/** The server refused to start because the socket folder could be reached by others. */
export class UnsafeSocketDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeSocketDirectoryError';
  }
}

/** Longest request line accepted from a connection. */
const MAX_REQUEST_BYTES = 64 * 1024;

/**
 * Creates the folder with mode 0700 if needed, then checks that it is a real folder
 * (not a symbolic link), owned by this user, with no group or world access.
 */
export async function prepareSocketDirectory(dir: string, uid: number): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory()) {
    throw new UnsafeSocketDirectoryError(`Socket folder ${dir} is a symbolic link or not a folder`);
  }
  if (info.uid !== uid) {
    throw new UnsafeSocketDirectoryError(`Socket folder ${dir} is not owned by the current user`);
  }
  if ((info.mode & 0o077) !== 0) {
    throw new UnsafeSocketDirectoryError(
      `Socket folder ${dir} must not be accessible by group or others (use mode 0700)`,
    );
  }
}

export interface AdminChannelOptions {
  readonly dir: string;
  readonly approvals: ApprovalService;
  readonly logger: Logger;
  readonly clock: Clock;
  /** Shown by `approve` when several servers are running. */
  readonly info: { readonly mode: string; readonly auditPath: string };
  readonly uid?: number;
  readonly pid?: number;
  readonly isAlive?: (pid: number) => boolean;
}

export class AdminChannel {
  private server: Server | undefined;
  private readonly connections = new Set<Socket>();
  private readonly pid: number;
  private readonly startedAt: string;

  constructor(private readonly options: AdminChannelOptions) {
    this.pid = options.pid ?? process.pid;
    this.startedAt = new Date(options.clock.now()).toISOString();
  }

  /** Connections currently open on the socket. */
  get openConnections(): ReadonlySet<Socket> {
    return this.connections;
  }

  get socketPath(): string {
    return join(this.options.dir, `${this.pid}.sock`);
  }

  async start(): Promise<void> {
    // getuid exists on macOS and Linux, the supported platforms.
    const uid = this.options.uid ?? (process.getuid as () => number)();
    await prepareSocketDirectory(this.options.dir, uid);
    await this.removeStaleSockets();

    const server = createServer((socket) => {
      this.serve(socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    await chmod(this.socketPath, 0o600);
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      for (const connection of this.connections) connection.destroy();
    });
    await rm(this.socketPath, { force: true });
  }

  /** Removes sockets of processes that no longer exist, and any leftover of our own ID. */
  private async removeStaleSockets(): Promise<void> {
    const isAlive = this.options.isAlive ?? isProcessAlive;
    await rm(this.socketPath, { force: true });
    for (const name of await readdir(this.options.dir)) {
      const match = /^(\d+)\.sock$/.exec(name);
      if (match !== null && !isAlive(Number(match[1]))) {
        await rm(join(this.options.dir, name), { force: true });
      }
    }
  }

  private serve(socket: Socket): void {
    socket.setEncoding('utf8');
    this.connections.add(socket);
    socket.on('close', () => {
      this.connections.delete(socket);
    });
    // A reset connection needs no handling: the human simply runs `approve` again.
    socket.on('error', () => undefined);
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy();
        return;
      }
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        socket.write(`${JSON.stringify(this.respond(line))}\n`);
      }
    });
  }

  private respond(line: string): Record<string, unknown> {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      return { ok: false, reason: 'bad_request' };
    }
    if (typeof request !== 'object' || request === null) {
      return { ok: false, reason: 'bad_request' };
    }
    const { op, requestId } = request as { op?: unknown; requestId?: unknown };
    switch (op) {
      case 'info':
        return {
          ok: true,
          pid: this.pid,
          mode: this.options.info.mode,
          auditPath: this.options.info.auditPath,
          startedAt: this.startedAt,
        };
      case 'list':
        return { ok: true, pending: this.options.approvals.listPending() };
      case 'approve':
        return typeof requestId === 'string'
          ? this.approve(requestId)
          : { ok: false, reason: 'bad_request' };
      default:
        return { ok: false, reason: 'unknown_op' };
    }
  }

  private approve(requestId: string): Record<string, unknown> {
    const result = this.options.approvals.approve(requestId);
    if (!result.ok) {
      this.options.logger.warn('approve.refused', { reason: result.reason });
      return { ok: false, reason: result.reason };
    }
    return {
      ok: true,
      requestId: result.requestId,
      validUntil: new Date(result.validUntilMs).toISOString(),
    };
  }
}
