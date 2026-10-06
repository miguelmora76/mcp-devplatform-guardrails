import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/core/config.js';

const tokenA = 'mgt_TESTaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const tokenB = 'mgt_TESTbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function tokenPairs(count: number): string {
  return Array.from({ length: count }, (_, index) => {
    const filler = String.fromCharCode(97 + index).repeat(30);
    return `client${index}=mgt_TEST${filler}`;
  }).join(',');
}

function configError(env: Record<string, string>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

describe('Given configuration comes from environment variables only', () => {
  describe('And no variables are set', () => {
    it('When the config is loaded, then safe defaults apply and live mode is off', () => {
      const config = loadConfig({ HOME: '/home/someone' });
      expect(config).toEqual({
        tokens: [],
        auditPath: './audit/audit.jsonl',
        logLevel: 'info',
        liveMode: false,
        socketDir: '/home/someone/.mcp-guardrails/run',
        httpPort: 8787,
      });
    });
  });

  describe('And the process environment holds values the caller did not pass in', () => {
    it('When the config is loaded from an empty map, then process.env is not consulted', () => {
      process.env.GUARDRAILS_LOG_LEVEL = 'debug';
      try {
        expect(loadConfig({ HOME: '/h' }).logLevel).toBe('info');
      } finally {
        delete process.env.GUARDRAILS_LOG_LEVEL;
      }
    });
  });

  describe('And values are provided', () => {
    it('When tokens, paths, level and live switch are set, then they are parsed', () => {
      const config = loadConfig({
        GUARDRAILS_TOKENS: ` alpha=${tokenA} , beta=${tokenB} `,
        GUARDRAILS_AUDIT_PATH: '/var/tmp/audit.jsonl',
        GUARDRAILS_LOG_LEVEL: 'debug',
        GUARDRAILS_LIVE: 'true',
        GUARDRAILS_SOCKET_DIR: '/run/me',
      });
      expect(config.tokens).toEqual([
        { name: 'alpha', token: tokenA },
        { name: 'beta', token: tokenB },
      ]);
      expect(config.auditPath).toBe('/var/tmp/audit.jsonl');
      expect(config.logLevel).toBe('debug');
      expect(config.liveMode).toBe(true);
      expect(config.socketDir).toBe('/run/me');
    });

    it('When the live switch is anything but 1 or true, then live mode stays off', () => {
      expect(loadConfig({ GUARDRAILS_LIVE: 'yes please' }).liveMode).toBe(false);
      expect(loadConfig({ GUARDRAILS_LIVE: '1' }).liveMode).toBe(true);
    });

    it('When HOME is missing, then the socket directory falls back to the OS home directory', () => {
      expect(loadConfig({}).socketDir.endsWith('/.mcp-guardrails/run')).toBe(true);
    });
  });

  describe('And the token list breaks a rule', () => {
    it('When exactly 5 tokens are configured, then the config loads', () => {
      expect(loadConfig({ GUARDRAILS_TOKENS: tokenPairs(5) }).tokens).toHaveLength(5);
    });

    it('When 6 tokens are configured, then startup is refused', () => {
      expect(configError({ GUARDRAILS_TOKENS: tokenPairs(6) }).message).toMatch(/at most 5/);
    });

    it('When two entries share a name, then startup is refused', () => {
      const error = configError({
        GUARDRAILS_TOKENS: `same=${tokenA},same=${tokenB}`,
      });
      expect(error.message).toMatch(/duplicate name/);
    });

    it('When two entries share a token, then startup is refused', () => {
      const error = configError({ GUARDRAILS_TOKENS: `one=${tokenA},two=${tokenA}` });
      expect(error.message).toMatch(/duplicate token/);
    });

    it('When a token carries less than 128 bits, then startup is refused without printing it', () => {
      const short = 'mgt_shortsecret';
      const error = configError({ GUARDRAILS_TOKENS: `weak=${short}` });
      expect(error.message).toMatch(/128 bits/);
      expect(error.message).not.toContain(short);
    });

    it('When a token uses characters outside base64url, then startup is refused', () => {
      const error = configError({ GUARDRAILS_TOKENS: `odd=mgt_TEST${'!'.repeat(30)}` });
      expect(error.message).toMatch(/characters/);
    });

    it('When an entry has no equals sign or a bad name, then startup is refused', () => {
      expect(configError({ GUARDRAILS_TOKENS: tokenA }).message).toMatch(/name=token/);
      expect(configError({ GUARDRAILS_TOKENS: `bad name=${tokenA}` }).message).toMatch(/name/);
    });

    it('When an entry in the list is empty, then startup is refused', () => {
      expect(configError({ GUARDRAILS_TOKENS: `a=${tokenA},,b=${tokenB}` }).message).toMatch(
        /empty/,
      );
    });
  });

  describe('And the HTTP port is configured', () => {
    it.each([
      ['0', 0],
      ['8080', 8080],
      ['65535', 65535],
    ])('When it is %s, then it is accepted', (raw, port) => {
      expect(loadConfig({ GUARDRAILS_HTTP_PORT: raw }).httpPort).toBe(port);
    });

    it.each(['-1', '65536', 'abc', '80.5', ''])('When it is %j, then startup is refused', (raw) => {
      expect(configError({ GUARDRAILS_HTTP_PORT: raw }).message).toContain('GUARDRAILS_HTTP_PORT');
    });
  });

  describe('And other values are malformed', () => {
    it('When the log level is unknown, then startup is refused naming the variable', () => {
      const error = configError({ GUARDRAILS_LOG_LEVEL: 'chatty' });
      expect(error.message).toContain('GUARDRAILS_LOG_LEVEL');
      expect(error.code).toBe('config.invalid');
    });

    it('When the audit path is empty, then startup is refused', () => {
      expect(configError({ GUARDRAILS_AUDIT_PATH: '   ' }).message).toContain(
        'GUARDRAILS_AUDIT_PATH',
      );
    });
  });
});
