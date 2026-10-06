#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIdSource } from '../core/identity.js';
import { systemClock, systemRng, systemScheduler } from '../core/ports.js';
import { runWalkthrough } from '../walkthrough.js';

/** `npm run walkthrough`: runs the documented walkthrough in a throwaway temp folder. */
const directory = await mkdtemp(join(tmpdir(), 'guardrails-walkthrough-'));
try {
  await runWalkthrough({
    directory,
    clock: systemClock,
    scheduler: systemScheduler,
    rng: systemRng,
    ids: createIdSource(systemRng),
    print: (text) => {
      console.log(text);
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'walkthrough failed');
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
