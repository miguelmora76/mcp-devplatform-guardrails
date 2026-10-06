import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  MAX_DOCUMENT_BYTES,
  SnapshotStore,
  type SnapshotFiles,
} from '../../src/data/snapshot-store.js';

const schema = z.object({ ok: z.boolean() });

/** An in-memory snapshot folder that counts reads. */
class FakeFiles implements SnapshotFiles {
  reads = 0;
  constructor(private readonly files: Record<string, { size: number; text: string }>) {}

  size(path: string): Promise<number> {
    const file = this.files[path];
    return file === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(file.size);
  }

  read(path: string): Promise<string> {
    this.reads += 1;
    const file = this.files[path];
    return file === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(file.text);
  }
}

const doc = (text = '{"ok":true}', size = text.length) => ({ size, text });
const path = (name: string, file: string) => `/snap/${name}/${file}`;

describe('Given the bundled snapshot store', () => {
  it('When a bundled document is read, then it is parsed and validated', async () => {
    const files = new FakeFiles({ [path('sample-node-api', 'manifest.json')]: doc() });
    const store = new SnapshotStore('/snap', { files });
    expect(await store.readJson('sample-node-api', 'manifest.json', schema)).toEqual({ ok: true });
  });

  it('When the name is not in the fixed list, then it is not found and no file is touched', async () => {
    const files = new FakeFiles({});
    const store = new SnapshotStore('/snap', { files });
    await expect(store.readJson('../etc', 'manifest.json', schema)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(files.reads).toBe(0);
  });

  it('When the file is missing, then the defined error names the snapshot', async () => {
    const store = new SnapshotStore('/snap', { files: new FakeFiles({}) });
    await expect(store.readJson('sample-node-api', 'manifest.json', schema)).rejects.toThrow(
      /sample-node-api has no manifest.json/,
    );
  });

  it('When the file is not JSON or has the wrong shape, then a defined error names the snapshot', async () => {
    const files = new FakeFiles({
      [path('sample-node-api', 'manifest.json')]: doc('{not json'),
      [path('sample-web-app', 'manifest.json')]: doc('{"ok":"yes"}'),
    });
    const store = new SnapshotStore('/snap', { files });
    await expect(store.readJson('sample-node-api', 'manifest.json', schema)).rejects.toMatchObject({
      code: 'snapshot_invalid',
    });
    await expect(store.readJson('sample-web-app', 'manifest.json', schema)).rejects.toMatchObject({
      code: 'snapshot_invalid',
    });
  });

  it('When a document is exactly 5 MiB it is accepted; one byte more is refused before it is read', async () => {
    const files = new FakeFiles({
      [path('sample-node-api', 'manifest.json')]: doc('{"ok":true}', MAX_DOCUMENT_BYTES),
      [path('sample-web-app', 'manifest.json')]: doc('{"ok":true}', MAX_DOCUMENT_BYTES + 1),
    });
    const store = new SnapshotStore('/snap', { files });
    expect(await store.readJson('sample-node-api', 'manifest.json', schema)).toEqual({ ok: true });
    const readsBefore = files.reads;
    await expect(store.readJson('sample-web-app', 'manifest.json', schema)).rejects.toMatchObject({
      code: 'too_large',
    });
    expect(files.reads).toBe(readsBefore);
  });

  it('When the same document is read twice, then the second read comes from the cache', async () => {
    const files = new FakeFiles({ [path('sample-node-api', 'manifest.json')]: doc() });
    const store = new SnapshotStore('/snap', { files });
    await store.readJson('sample-node-api', 'manifest.json', schema);
    await store.readJson('sample-node-api', 'manifest.json', schema);
    expect(files.reads).toBe(1);
  });

  it('When more documents are read than the cache holds, then the least recently used is evicted', async () => {
    const files = new FakeFiles({
      [path('sample-node-api', 'manifest.json')]: doc(),
      [path('sample-node-api', 'registry.json')]: doc(),
      [path('sample-node-api', 'advisories.json')]: doc(),
    });
    const store = new SnapshotStore('/snap', { files, cacheSize: 2 });
    await store.readJson('sample-node-api', 'manifest.json', schema);
    await store.readJson('sample-node-api', 'registry.json', schema);
    await store.readJson('sample-node-api', 'manifest.json', schema); // manifest is now most recent
    await store.readJson('sample-node-api', 'advisories.json', schema); // evicts registry
    expect(files.reads).toBe(3);
    await store.readJson('sample-node-api', 'manifest.json', schema);
    expect(files.reads).toBe(3);
    await store.readJson('sample-node-api', 'registry.json', schema);
    expect(files.reads).toBe(4);
  });

  it('When the real bundled snapshots are read, then every listed snapshot has all its files', async () => {
    const { SNAPSHOT_FILES, SNAPSHOT_NAMES } = await import('../../src/data/snapshot-store.js');
    const store = new SnapshotStore();
    for (const name of SNAPSHOT_NAMES) {
      for (const file of SNAPSHOT_FILES) {
        const loose = await store.readJson(
          name,
          file,
          z.object({ synthetic: z.literal(true) }).loose(),
        );
        expect(loose.synthetic).toBe(true);
      }
    }
  });
});
