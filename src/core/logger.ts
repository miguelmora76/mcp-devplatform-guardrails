import type { LogLevel } from './config.js';
import { LOG_LEVELS } from './config.js';
import type { Clock } from './ports.js';
import type { Redactor } from './redactor.js';

/**
 * Operational log (LC-11): one JSON object per line to an injected sink (standard error in
 * the real server). The logger has no path to standard output, which carries the MCP
 * protocol only. Every line passes through the redactor first.
 */

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  error(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  /** A logger for another component that shares this one's sink, level and redactor. */
  forComponent(component: string): Logger;
}

export interface LoggerOptions {
  readonly sink: (line: string) => void;
  readonly clock: Clock;
  readonly redactor: Redactor;
  readonly level: LogLevel;
  readonly component: string;
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LOG_LEVELS.indexOf(options.level);

  const write = (level: LogLevel, msg: string, fields: LogFields = {}): void => {
    if (LOG_LEVELS.indexOf(level) > threshold) return;
    const entry = {
      ts: new Date(options.clock.now()).toISOString(),
      level,
      component: options.component,
      msg,
      ...fields,
    };
    options.sink(JSON.stringify(options.redactor.redact(entry)));
  };

  return {
    error: (msg, fields) => write('error', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    debug: (msg, fields) => write('debug', msg, fields),
    forComponent: (component) => createLogger({ ...options, component }),
  };
}
