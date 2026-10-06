import { describe, expect, it } from 'vitest';
import { parseRepositoryRef } from '../../src/core/repository-ref.js';

describe('Given a repository reference from the agent', () => {
  it('When it is a bundled snapshot name, then it is a snapshot reference', () => {
    expect(parseRepositoryRef('sample-node-api')).toEqual({
      kind: 'snapshot',
      name: 'sample-node-api',
    });
  });

  it('When it is owner/name, then it is a public GitHub reference', () => {
    expect(parseRepositoryRef('octo-org/hello.world_2')).toEqual({
      kind: 'github',
      owner: 'octo-org',
      name: 'hello.world_2',
    });
    expect(parseRepositoryRef('a/.github')).toMatchObject({ kind: 'github', name: '.github' });
  });

  it.each([
    ['a URL', 'https://github.com/octo/hello'],
    ['a URL with credentials', 'https://user:hunter2@github.com/octo/hello'],
    ['an SSH remote', 'git@github.com:octo/hello.git'],
    ['a path traversal', '../../etc/passwd'],
    ['parent segments', '../hello'],
    ['a dot segment', './hello'],
    ['an absolute path', '/etc/passwd'],
    ['three segments', 'a/b/c'],
    ['an empty owner', '/hello'],
    ['an empty name', 'octo/'],
    ['a space', 'octo/hel lo'],
    ['an upper-case snapshot-style name', 'Sample'],
    ['an empty string', ''],
    ['an over-long segment', `${'a'.repeat(101)}/b`],
    ['a backslash', 'a\\b'],
    ['an at sign', 'a@b/c'],
  ])('When it is %s, then it is refused', (_label, text) => {
    expect(parseRepositoryRef(text)).toBeUndefined();
  });
});
