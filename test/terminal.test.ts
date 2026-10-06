import { describe, expect, it } from 'vitest';
import { openTerminal, type TerminalDeps } from '../src/terminal.js';

/** A fake terminal device that records every open, close and destroy. */
function fakeDevice(options: { failOpenOn?: 'r' | 'w'; noTerminal?: boolean } = {}) {
  const events: string[] = [];
  let nextFd = 10;
  let answer: ((value: string) => void) | undefined;
  let closeLines: (() => void) | undefined;
  const deps: TerminalDeps = {
    open: (mode) => {
      if (options.noTerminal === true || options.failOpenOn === mode) throw new Error('ENXIO');
      nextFd += 1;
      events.push(`open ${mode} fd${nextFd}`);
      return nextFd;
    },
    closeFd: (fd) => events.push(`closeFd fd${fd}`),
    createInput: (fd) => ({ destroy: () => events.push(`destroy input fd${fd}`) }),
    createOutput: (fd) => ({ destroy: () => events.push(`destroy output fd${fd}`) }),
    createLines: () => ({
      question: (prompt, callback) => {
        events.push(`question ${prompt}`);
        answer = callback;
      },
      close: () => events.push('lines.close'),
      onClose: (callback) => {
        closeLines = callback;
      },
    }),
  };
  return { deps, events, reply: (text: string) => answer?.(text), endInput: () => closeLines?.() };
}

describe('Given the terminal the approve command confirms with', () => {
  it('When there is no controlling terminal, then nothing is opened and there is no terminal', () => {
    const { deps, events } = fakeDevice({ noTerminal: true });
    expect(openTerminal(deps)).toBeUndefined();
    expect(events).toEqual([]);
  });

  it('When the device opens, then input and output each get their own file descriptor', () => {
    const { deps, events } = fakeDevice();
    openTerminal(deps);
    expect(events).toEqual(['open r fd11', 'open w fd12']);
  });

  it('When the output cannot be opened after the input was, then the input descriptor is closed and there is no terminal', () => {
    const { deps, events } = fakeDevice({ failOpenOn: 'w' });
    expect(openTerminal(deps)).toBeUndefined();
    expect(events).toEqual(['open r fd11', 'closeFd fd11']);
  });

  it('When the human answers, then the answer is returned and the question was shown', async () => {
    const { deps, events, reply } = fakeDevice();
    const opened = openTerminal(deps);
    const pending = opened?.terminal.ask('Type yes: ');
    expect(events).toContain('question Type yes: ');
    reply('yes');
    expect(await pending).toBe('yes');
  });

  it('When the input ends before an answer (for example Ctrl-D), then the question resolves with an empty answer instead of hanging', async () => {
    const { deps, endInput } = fakeDevice();
    const pending = openTerminal(deps)?.terminal.ask('Type yes: ');
    endInput();
    expect(await pending).toBe('');
  });

  it('When it is closed, then the line reader and both streams are closed once each, and no descriptor is closed a second time by hand', () => {
    const { deps, events } = fakeDevice();
    openTerminal(deps)?.close();
    expect(events.slice(2)).toEqual(['lines.close', 'destroy input fd11', 'destroy output fd12']);
    expect(events.filter((e) => e.startsWith('closeFd'))).toEqual([]);
  });

  it('When it is closed twice, then the second close does nothing', () => {
    const { deps, events } = fakeDevice();
    const opened = openTerminal(deps);
    opened?.close();
    opened?.close();
    expect(events.filter((e) => e.startsWith('destroy'))).toHaveLength(2);
  });
});
