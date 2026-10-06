import { readdir, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { PendingView } from './approval.js';

/**
 * The human's side of the admin channel (LC-08): everything the `approve` command does
 * except talking to the terminal device itself, so it can be tested against a real
 * socket. It lists pending requests with their agent-supplied text escaped, requires a
 * terminal, and approves only after the human types `yes` (NFR1.3).
 */

export type AdminReply = Record<string, unknown> & { readonly ok: boolean };

/** Sends one request line to a server socket and returns its one-line reply. */
export function requestServer(socketPath: string, request: object): Promise<AdminReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const lines = createInterface({ input: socket });
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    lines.once('line', (line) => {
      socket.destroy();
      try {
        resolve(JSON.parse(line) as AdminReply);
      } catch (error) {
        // JSON.parse only ever throws a SyntaxError.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error);
      }
    });
    socket.on('close', () => {
      reject(new Error('The server closed the connection without replying.'));
    });
    const fail = (error: Error): void => {
      reject(error);
    };
    socket.on('error', fail);
    lines.on('error', fail);
  });
}

export interface ServerInfo {
  readonly socketPath: string;
  readonly pid: number;
  readonly mode: string;
  readonly auditPath: string;
  readonly startedAt: string;
}

/**
 * Finds the running servers in the socket folder. A socket that refuses connections
 * belongs to a process that has gone, and is deleted.
 */
export async function discoverServers(dir: string): Promise<ServerInfo[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const servers: ServerInfo[] = [];
  for (const name of names.filter((candidate) => candidate.endsWith('.sock')).sort()) {
    const socketPath = join(dir, name);
    try {
      const reply = await requestServer(socketPath, { op: 'info' });
      servers.push({
        socketPath,
        pid: Number(reply.pid),
        mode: String(reply.mode),
        auditPath: String(reply.auditPath),
        startedAt: String(reply.startedAt),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        await rm(socketPath, { force: true });
      }
    }
  }
  return servers;
}

// Control characters, plus invisible and direction-changing characters that can make text
// look different from what it is.
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** Renders agent-supplied text safely: unsafe characters become \xNN or \uNNNN. */
export function escapeForDisplay(text: string): string {
  return text.replace(UNSAFE_CHARACTERS, (character) => {
    const code = character.charCodeAt(0);
    return code <= 0xff
      ? `\\x${code.toString(16).padStart(2, '0')}`
      : `\\u${code.toString(16).padStart(4, '0')}`;
  });
}

/** The exact action as the human sees it before confirming. */
export function formatPending(view: PendingView): string {
  return [
    `Request:  ${escapeForDisplay(view.requestId)}`,
    `Tool:     ${escapeForDisplay(view.tool)}`,
    `Client:   ${escapeForDisplay(view.client)}`,
    `Inputs:   ${escapeForDisplay(JSON.stringify(view.inputs))}`,
    `Digest:   ${escapeForDisplay(view.digest)}`,
    `Asked at: ${new Date(view.createdAt).toISOString()}`,
    `Expires:  ${new Date(view.expiresAt).toISOString()}`,
  ].join('\n');
}

/** The controlling terminal. `approve` refuses to run without one. */
export interface Terminal {
  ask(question: string): Promise<string>;
}

export interface ApproveOptions {
  readonly dir: string;
  /** Go straight to this request instead of choosing from a list. */
  readonly ref?: string;
  readonly terminal: Terminal | undefined;
  readonly print: (text: string) => void;
}

/** Runs the `approve` command. Returns the process exit code: 0 approved or nothing to do. */
export async function runApprove(options: ApproveOptions): Promise<number> {
  const { terminal, print } = options;
  if (terminal === undefined) {
    print('approve needs a terminal to confirm with. Run it yourself in a terminal window.');
    return 1;
  }
  const servers = await discoverServers(options.dir);
  if (servers.length === 0) {
    print('No running guardrails server was found.');
    return 1;
  }
  const server = await choose(
    terminal,
    print,
    'Several servers are running:',
    servers,
    (item, index) =>
      `  ${index + 1}. pid ${item.pid}, ${escapeForDisplay(item.mode)} mode, started ${escapeForDisplay(item.startedAt)}, audit ${escapeForDisplay(item.auditPath)}`,
  );
  if (server === undefined) return 1;

  const reply = await requestServer(server.socketPath, { op: 'list' });
  const pending = reply.pending as PendingView[];
  if (options.ref !== undefined) {
    const found = pending.find((view) => view.requestId === options.ref);
    if (found === undefined) {
      print(`No pending request ${escapeForDisplay(options.ref)} on that server.`);
      return 1;
    }
    return confirm(terminal, print, server, found);
  }
  if (pending.length === 0) {
    print('No pending approvals.');
    return 0;
  }
  const chosen = await choose(
    terminal,
    print,
    'Pending approvals:',
    pending,
    (view, index) =>
      `  ${index + 1}. ${escapeForDisplay(view.tool)} for ${escapeForDisplay(view.client)} (${escapeForDisplay(view.requestId)})`,
  );
  if (chosen === undefined) return 1;
  return confirm(terminal, print, server, chosen);
}

/** With one item, returns it; with several, asks for a number. Undefined when the answer is invalid. */
async function choose<T>(
  terminal: Terminal,
  print: (text: string) => void,
  heading: string,
  items: readonly T[],
  describe: (item: T, index: number) => string,
): Promise<T | undefined> {
  if (items.length === 1) return items[0];
  print(heading);
  items.forEach((item, index) => {
    print(describe(item, index));
  });
  const answer = Number((await terminal.ask(`Choose 1-${items.length}: `)).trim());
  const picked = items[answer - 1];
  if (!Number.isInteger(answer) || picked === undefined) {
    print('That is not one of the choices. Nothing was approved.');
    return undefined;
  }
  return picked;
}

async function confirm(
  terminal: Terminal,
  print: (text: string) => void,
  server: ServerInfo,
  view: PendingView,
): Promise<number> {
  print(formatPending(view));
  const answer = await terminal.ask('Type yes to approve, anything else to cancel: ');
  if (answer.trim() !== 'yes') {
    print('Not approved.');
    return 1;
  }
  const result = await requestServer(server.socketPath, {
    op: 'approve',
    requestId: view.requestId,
  });
  if (!result.ok) {
    print(`Not approved: ${escapeForDisplay(String(result.reason))}.`);
    return 1;
  }
  print(`Approved. Valid until ${escapeForDisplay(String(result.validUntil))}.`);
  return 0;
}
