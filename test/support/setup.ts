import net from 'node:net';
import dgram from 'node:dgram';

/**
 * Offline guard (NFR5.1). The suite must pass with the network disabled, so any attempt
 * to reach a non-local address fails the test. Loopback addresses and Unix sockets stay
 * available because the HTTP-mode and admin-socket specs talk to the server under test.
 */
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);

type ConnectArgs = Parameters<net.Socket['connect']>;

function describeTarget(rawArgs: ConnectArgs): { local: boolean; target: string } {
  // net.connect() hands Socket#connect an already-normalised [options, callback] array.
  const args = (Array.isArray(rawArgs[0]) ? rawArgs[0] : rawArgs) as unknown as ConnectArgs;
  const first: unknown = args[0];
  if (typeof first === 'string') {
    // connect(path) or connect(port, host) with a numeric string port.
    return /^\d+$/.test(first)
      ? { local: loopbackFromHost(args[1]), target: `${first}:${String(args[1])}` }
      : { local: true, target: first };
  }
  if (typeof first === 'number') {
    return { local: loopbackFromHost(args[1]), target: `${first}:${String(args[1])}` };
  }
  if (typeof first === 'object' && first !== null) {
    const options = first as { path?: unknown; host?: unknown; port?: unknown };
    if (typeof options.path === 'string') return { local: true, target: options.path };
    return {
      local: loopbackFromHost(options.host),
      target: `${String(options.host)}:${String(options.port)}`,
    };
  }
  return { local: false, target: 'unknown' };
}

function loopbackFromHost(host: unknown): boolean {
  // Node connects to localhost when no host is given.
  return host === undefined || (typeof host === 'string' && loopbackHosts.has(host));
}

// eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied with the right `this` below
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: ConnectArgs) {
  const { local, target } = describeTarget(args);
  if (!local) {
    throw new Error(`Offline guard: network connection to ${target} is not allowed in tests`);
  }
  return (originalConnect as (...a: ConnectArgs) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;

dgram.createSocket = function guardedDgram(): never {
  throw new Error('Offline guard: datagram sockets are not allowed in tests');
};

// eslint-disable-next-line no-restricted-properties -- this file installs the guard
globalThis.fetch = function guardedFetch(): never {
  throw new Error('Offline guard: use the injected Net port; the global fetch is blocked in tests');
};
