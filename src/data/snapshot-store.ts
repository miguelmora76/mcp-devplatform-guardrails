import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { GuardrailError } from '../core/errors.js';

/**
 * Snapshot store (LC-13): reads the bundled, synthetic sample repositories. Snapshot names
 * and file names come from fixed lists and are never joined to a path from input, so a
 * caller cannot reach any other file. A document over 5 MiB is refused before it is read
 * (never truncated), and up to 8 parsed documents are kept in a small least-recently-used
 * cache (NFR1.11, performance-design.md).
 */

export const SNAPSHOT_NAMES = ['sample-node-api', 'sample-web-app', 'sample-cli-tool'] as const;
export type SnapshotName = (typeof SNAPSHOT_NAMES)[number];

export const SNAPSHOT_FILES = [
  'ci-runs.json',
  'manifest.json',
  'registry.json',
  'advisories.json',
] as const;
export type SnapshotFile = (typeof SNAPSHOT_FILES)[number];

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const DEFAULT_CACHE_SIZE = 8;

/** `<project root>/snapshots`, found relative to this module in both `src` and `dist`. */
export const DEFAULT_SNAPSHOT_ROOT = fileURLToPath(new URL('../../snapshots/', import.meta.url));

export function isSnapshotName(value: string): value is SnapshotName {
  return (SNAPSHOT_NAMES as readonly string[]).includes(value);
}

/** The file access the store needs (replaceable in tests). */
export interface SnapshotFiles {
  size(path: string): Promise<number>;
  read(path: string): Promise<string>;
}

const diskFiles: SnapshotFiles = {
  size: async (path) => (await stat(path)).size,
  read: (path) => readFile(path, 'utf8'),
};

export interface SnapshotStoreOptions {
  readonly files?: SnapshotFiles;
  readonly cacheSize?: number;
}

export class SnapshotStore {
  private readonly files: SnapshotFiles;
  private readonly cacheSize: number;
  private readonly cache = new Map<string, unknown>();

  constructor(
    private readonly root: string = DEFAULT_SNAPSHOT_ROOT,
    options: SnapshotStoreOptions = {},
  ) {
    this.files = options.files ?? diskFiles;
    this.cacheSize = options.cacheSize ?? DEFAULT_CACHE_SIZE;
  }

  async readJson<T>(name: string, file: SnapshotFile, schema: z.ZodType<T>): Promise<T> {
    if (!isSnapshotName(name)) {
      throw new GuardrailError('not_found', 'No bundled snapshot has that name.');
    }
    const parsed = await this.load(name, file);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new GuardrailError(
        'snapshot_invalid',
        `Snapshot ${name}: ${file} has an unexpected shape.`,
      );
    }
    return result.data;
  }

  private async load(name: SnapshotName, file: SnapshotFile): Promise<unknown> {
    const key = `${name}/${file}`;
    if (this.cache.has(key)) {
      const hit = this.cache.get(key);
      // Re-insert so the entry counts as most recently used.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const path = join(this.root, name, file);
    let text: string;
    try {
      if ((await this.files.size(path)) > MAX_DOCUMENT_BYTES) {
        throw new GuardrailError('too_large', `Snapshot ${name}: ${file} is over 5 MiB.`);
      }
      text = await this.files.read(path);
    } catch (error) {
      if (error instanceof GuardrailError) throw error;
      throw new GuardrailError('not_found', `Snapshot ${name} has no ${file}.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GuardrailError('snapshot_invalid', `Snapshot ${name}: ${file} is not valid JSON.`);
    }
    this.cache.set(key, parsed);
    if (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
    return parsed;
  }
}
