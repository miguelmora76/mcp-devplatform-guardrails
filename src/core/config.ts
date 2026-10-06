import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Configuration (LC-17). Reads the environment map it is given and nothing else; secrets
 * (HTTP tokens) exist only here, read once at startup. Error messages name the variable
 * or the entry's position, never a token value.
 */

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const MAX_TOKENS = 5;
const MIN_TOKEN_BITS = 128;
const BITS_PER_CHARACTER = 6; // base64url
const GENERATED_TOKEN_PREFIX = 'mgt_';

export interface TokenEntry {
  readonly name: string;
  readonly token: string;
}

export interface Config {
  /** HTTP-mode clients; empty in stdio mode. A client is a token (at most 5). */
  readonly tokens: readonly TokenEntry[];
  readonly auditPath: string;
  readonly logLevel: LogLevel;
  /** Live GitHub reading; off unless explicitly switched on. */
  readonly liveMode: boolean;
  /** Directory for the admin socket (created with mode 0700). */
  readonly socketDir: string;
  /** Loopback port for HTTP mode; 0 picks a free one. */
  readonly httpPort: number;
}

export class ConfigError extends Error {
  readonly code = 'config.invalid';
}

export type Environment = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Environment): Config {
  return {
    tokens: parseTokens(env.GUARDRAILS_TOKENS),
    auditPath: parseAuditPath(env.GUARDRAILS_AUDIT_PATH),
    logLevel: parseLogLevel(env.GUARDRAILS_LOG_LEVEL),
    liveMode: env.GUARDRAILS_LIVE === '1' || env.GUARDRAILS_LIVE === 'true',
    socketDir: env.GUARDRAILS_SOCKET_DIR ?? join(env.HOME ?? homedir(), '.mcp-guardrails', 'run'),
    httpPort: parsePort(env.GUARDRAILS_HTTP_PORT),
  };
}

function parseAuditPath(raw: string | undefined): string {
  if (raw === undefined) return './audit/audit.jsonl';
  if (raw.trim() === '') throw new ConfigError('GUARDRAILS_AUDIT_PATH must not be empty');
  return raw;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 8787;
  const port = Number(raw);
  if (raw === '' || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError('GUARDRAILS_HTTP_PORT must be a whole number from 0 to 65535');
  }
  return port;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined) return 'info';
  const level = LOG_LEVELS.find((candidate) => candidate === raw);
  if (level === undefined) {
    throw new ConfigError(`GUARDRAILS_LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }
  return level;
}

function parseTokens(raw: string | undefined): readonly TokenEntry[] {
  if (raw === undefined || raw.trim() === '') return [];
  const entries = raw.split(',').map((part, index) => parseTokenEntry(part.trim(), index + 1));
  if (entries.length > MAX_TOKENS) {
    throw new ConfigError(
      `GUARDRAILS_TOKENS lists ${entries.length} tokens; at most ${MAX_TOKENS} are allowed`,
    );
  }
  const names = new Set<string>();
  const tokens = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw new ConfigError(`GUARDRAILS_TOKENS has a duplicate name: ${entry.name}`);
    }
    if (tokens.has(entry.token)) {
      throw new ConfigError('GUARDRAILS_TOKENS has a duplicate token');
    }
    names.add(entry.name);
    tokens.add(entry.token);
  }
  return entries;
}

function parseTokenEntry(part: string, position: number): TokenEntry {
  if (part === '') throw new ConfigError(`GUARDRAILS_TOKENS entry ${position} is empty`);
  const separator = part.indexOf('=');
  if (separator < 0) {
    throw new ConfigError(`GUARDRAILS_TOKENS entry ${position} must have the form name=token`);
  }
  const name = part.slice(0, separator);
  const token = part.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) {
    throw new ConfigError(
      `GUARDRAILS_TOKENS entry ${position}: name must be 1-32 letters, digits, _ or -`,
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new ConfigError(
      `GUARDRAILS_TOKENS entry ${position}: token may use only letters, digits, _ and - characters`,
    );
  }
  const secret = token.startsWith(GENERATED_TOKEN_PREFIX)
    ? token.slice(GENERATED_TOKEN_PREFIX.length)
    : token;
  if (secret.length * BITS_PER_CHARACTER < MIN_TOKEN_BITS) {
    throw new ConfigError(
      `GUARDRAILS_TOKENS entry ${position}: token must carry at least ${MIN_TOKEN_BITS} bits`,
    );
  }
  return { name, token };
}
