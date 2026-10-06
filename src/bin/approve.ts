#!/usr/bin/env node
import { closeSync, openSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ReadStream, WriteStream } from 'node:tty';
import { loadConfig } from '../core/config.js';
import { runApprove } from '../guardrails/admin-client.js';
import { openTerminal, type OpenTerminal } from '../terminal.js';

/**
 * `approve [requestId]`: a human's command for approving a pending write. It talks to a
 * running server over the per-user admin socket and reads the confirmation from the
 * controlling terminal (/dev/tty), so output piped or captured by an agent host cannot
 * answer for the human. The logic lives in src/guardrails/admin-client.ts.
 */

/** Opens the real controlling terminal; each stream owns its own descriptor. */
function openRealTerminal(): OpenTerminal | undefined {
  return openTerminal({
    open: (mode) => openSync('/dev/tty', mode),
    closeFd: (fd) => {
      closeSync(fd);
    },
    createInput: (fd) => new ReadStream(fd),
    createOutput: (fd) => new WriteStream(fd),
    createLines: (input, output) => {
      const lines = createInterface({ input: input as ReadStream, output: output as WriteStream });
      return {
        question: (prompt, callback) => {
          lines.question(prompt, callback);
        },
        close: () => {
          lines.close();
        },
        onClose: (callback) => {
          lines.once('close', callback);
        },
      };
    },
  });
}

async function main(): Promise<number> {
  const ref = process.argv[2];
  const opened = openRealTerminal();
  try {
    return await runApprove({
      dir: loadConfig(process.env).socketDir,
      terminal: opened?.terminal,
      print: (text) => {
        console.log(text);
      },
      ...(ref === undefined ? {} : { ref }),
    });
  } finally {
    opened?.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : 'approve failed');
    process.exitCode = 1;
  },
);
