#!/usr/bin/env node
import { closeSync, openSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ReadStream, WriteStream } from 'node:tty';
import { loadConfig } from '../core/config.js';
import { runApprove, type Terminal } from '../guardrails/admin-client.js';

/**
 * `approve [requestId]`: a human's command for approving a pending write. It talks to a
 * running server over the per-user admin socket and reads the confirmation from the
 * controlling terminal (/dev/tty), so output piped or captured by an agent host cannot
 * answer for the human. The logic lives in src/guardrails/admin-client.ts.
 */

function openTerminal(): { terminal: Terminal; close: () => void } | undefined {
  let fd: number;
  try {
    fd = openSync('/dev/tty', 'r+');
  } catch {
    return undefined;
  }
  const input = new ReadStream(fd);
  const output = new WriteStream(fd);
  const lines = createInterface({ input, output });
  return {
    terminal: {
      ask: (question) =>
        new Promise((resolve) => {
          lines.question(question, resolve);
        }),
    },
    close: () => {
      lines.close();
      closeSync(fd);
    },
  };
}

async function main(): Promise<number> {
  const ref = process.argv[2];
  const opened = openTerminal();
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
