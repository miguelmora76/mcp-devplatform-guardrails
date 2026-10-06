#!/usr/bin/env node
import { systemClock, systemRng, systemScheduler } from '../core/ports.js';
import { serve } from '../serve.js';

/** Process entry point: hands the real arguments, environment, signals and exit to `serve`. */
const failure = await serve({
  argv: process.argv.slice(2),
  env: process.env,
  clock: systemClock,
  scheduler: systemScheduler,
  rng: systemRng,
  logSink: (line) => {
    process.stderr.write(`${line}\n`);
  },
  exit: (code) => process.exit(code),
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
});
if (failure !== undefined) process.exitCode = failure;
