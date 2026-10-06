import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/core/logger.js';
import { createRedactor } from '../../src/core/redactor.js';
import type { LogLevel } from '../../src/core/config.js';
import { FakeClock } from '../support/fakes.js';

function setup(level: LogLevel = 'info') {
  const lines: string[] = [];
  const clock = new FakeClock(Date.UTC(2026, 9, 5, 12, 0, 0));
  const logger = createLogger({
    sink: (line) => lines.push(line),
    clock,
    redactor: createRedactor({ secrets: ['mgt_TESTconfiguredtokenvalue0123'] }),
    level,
    component: 'Test',
  });
  return { lines, logger };
}

describe('Given the operational logger', () => {
  it('When a line is logged, then it is one JSON object with the required fields', () => {
    const { lines, logger } = setup();
    logger.info('server.start', { mode: 'stdio', callId: 'call_aaaaaaaaaaaaaaaaaaaaaaaaab' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ts: '2026-10-05T12:00:00.000Z',
      level: 'info',
      component: 'Test',
      msg: 'server.start',
      mode: 'stdio',
      callId: 'call_aaaaaaaaaaaaaaaaaaaaaaaaab',
    });
  });

  it.each([
    ['error', ['error']],
    ['warn', ['error', 'warn']],
    ['info', ['error', 'warn', 'info']],
    ['debug', ['error', 'warn', 'info', 'debug']],
  ] as const)('When the level is %s, then only %j lines are written', (level, expected) => {
    const { lines, logger } = setup(level);
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    expect(lines.map((line) => (JSON.parse(line) as { level: string }).level)).toEqual(expected);
  });

  it('When a field holds a secret, then it is redacted before writing', () => {
    const { lines, logger } = setup();
    logger.error('tool.error', {
      authorization: 'Bearer abcdef',
      err: 'failed with mgt_TESTconfiguredtokenvalue0123',
    });
    expect(lines[0]).not.toContain('mgt_TESTconfiguredtokenvalue0123');
    expect(lines[0]).not.toContain('abcdef');
  });

  it('When a component logger is derived, then it shares the sink and names its component', () => {
    const { lines, logger } = setup();
    logger.forComponent('AuditWriter').info('x');
    expect((JSON.parse(lines[0] ?? '') as { component: string }).component).toBe('AuditWriter');
  });

  it('When anything is logged, then nothing is written to standard output', () => {
    const write = vi.spyOn(process.stdout, 'write');
    const { logger } = setup('debug');
    logger.error('a');
    logger.debug('b');
    expect(write).not.toHaveBeenCalled();
  });
});
