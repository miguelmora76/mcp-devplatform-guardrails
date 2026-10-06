import type { Terminal } from './guardrails/admin-client.js';

/**
 * The controlling terminal for the `approve` command. The device is opened twice, once for
 * reading and once for writing, so each stream owns exactly one descriptor and closing a
 * stream closes its descriptor exactly once; nothing closes a descriptor by hand after the
 * streams own it. Closing it releases everything, so the process can exit by itself.
 * The device access is injected, so this logic is tested without a real terminal.
 */

export interface DestroyableStream {
  destroy(): void;
}

export interface LineReader {
  question(prompt: string, callback: (answer: string) => void): void;
  close(): void;
  /** Runs when the line reader ends (for example the input reached end of file). */
  onClose(callback: () => void): void;
}

export interface TerminalDeps {
  /** Opens the controlling terminal; throws when there is none. Returns a descriptor. */
  open(mode: 'r' | 'w'): number;
  closeFd(fd: number): void;
  createInput(fd: number): DestroyableStream;
  createOutput(fd: number): DestroyableStream;
  createLines(input: DestroyableStream, output: DestroyableStream): LineReader;
}

export interface OpenTerminal {
  readonly terminal: Terminal;
  close(): void;
}

export function openTerminal(deps: TerminalDeps): OpenTerminal | undefined {
  let readFd: number;
  let writeFd: number;
  try {
    readFd = deps.open('r');
  } catch {
    return undefined;
  }
  try {
    writeFd = deps.open('w');
  } catch {
    // No stream owns the first descriptor yet, so it is closed here.
    deps.closeFd(readFd);
    return undefined;
  }
  const input = deps.createInput(readFd);
  const output = deps.createOutput(writeFd);
  const lines = deps.createLines(input, output);
  let closed = false;
  return {
    terminal: {
      ask: (question) =>
        new Promise((resolve) => {
          lines.onClose(() => {
            resolve('');
          });
          lines.question(question, resolve);
        }),
    },
    close: () => {
      if (closed) return;
      closed = true;
      lines.close();
      input.destroy();
      output.destroy();
    },
  };
}
