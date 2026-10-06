import { describe, expect, it } from 'vitest';
import {
  changeType,
  compareVersions,
  latestStable,
  parseRange,
  parseVersion,
  type Version,
} from '../../src/data/semver.js';

function v(text: string): Version {
  const parsed = parseVersion(text);
  if (parsed === undefined) throw new Error(`bad test version ${text}`);
  return parsed;
}

describe('Given version strings', () => {
  it.each(['1.2.3', '0.0.0', '10.20.30', '1.0.0-alpha.1', '1.0.0-rc.1+build.5', '2.0.0+meta'])(
    'When %s is parsed, then it is accepted',
    (text) => {
      expect(parseVersion(text)).toBeDefined();
    },
  );

  it.each([
    '1.2',
    'v1.2.3',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3.4',
    '',
    'latest',
    '1.2.3-',
    '1.2.3-a..b',
    '^1.2.3',
  ])('When %j is parsed, then it is refused', (text) => {
    expect(parseVersion(text)).toBeUndefined();
  });

  it('When a version is parsed, then its parts are numbers and the prerelease is split', () => {
    expect(v('3.4.5-beta.2+x')).toMatchObject({
      major: 3,
      minor: 4,
      patch: 5,
      prerelease: ['beta', '2'],
    });
  });
});

describe('Given two versions are compared by semantic-versioning precedence', () => {
  it('When the spec ordering example is sorted, then it comes out in the documented order', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    const shuffled = [...ordered].reverse();
    expect(shuffled.sort((a, b) => compareVersions(v(a), v(b)))).toEqual(ordered);
  });

  it.each([
    ['1.2.3', '1.2.3', 0],
    ['1.2.3', '1.2.4', -1],
    ['1.3.0', '1.2.9', 1],
    ['2.0.0', '1.99.99', 1],
    ['1.0.0+a', '1.0.0+b', 0],
    ['1.0.0-1', '1.0.0-alpha', -1],
  ])('When %s is compared with %s, then the sign is %i', (a, b, sign) => {
    expect(Math.sign(compareVersions(v(a), v(b)))).toBe(sign);
  });
});

describe('Given an upgrade from one version to another', () => {
  it.each([
    ['1.2.3', '2.0.0', 'major'],
    ['1.2.3', '1.3.0', 'minor'],
    ['1.2.3', '1.2.4', 'patch'],
    ['1.2.3', '1.2.3', 'none'],
    ['1.2.3', '1.2.2', 'none'],
    ['0.9.1', '0.10.0', 'minor'],
    ['2.0.0-rc.1', '2.0.0', 'patch'],
  ] as const)('When going from %s to %s, then the change is %s', (from, to, expected) => {
    expect(changeType(v(from), v(to))).toBe(expected);
  });
});

describe('Given dependency ranges as written in a manifest', () => {
  it.each([
    ['^4.17.1', '4.17.1'],
    ['~2.0.3', '2.0.3'],
    ['1.4.0', '1.4.0'],
    ['=1.4.0', '1.4.0'],
    [' ^0.9.1 ', '0.9.1'],
  ])('When %j is read, then the lowest accepted version is %s', (range, expected) => {
    expect(parseRange(range)?.raw).toBe(expected);
  });

  it.each([
    '>=1.0.0 <2.0.0',
    '*',
    'latest',
    'git+https://example.invalid/x.git',
    '1.x',
    '^1.2',
    '',
  ])('When %j is read, then it is not supported', (range) => {
    expect(parseRange(range)).toBeUndefined();
  });
});

describe('Given the published versions of a package', () => {
  it('When the latest stable is chosen, then pre-releases are ignored', () => {
    const latest = latestStable(['4.1.0', '5.0.0-rc.1', '4.6.2', '4.6.3-beta.1', 'not-a-version']);
    expect(latest?.raw).toBe('4.6.2');
  });

  it('When only pre-releases or nothing exist, then there is no stable version', () => {
    expect(latestStable(['1.0.0-beta.1'])).toBeUndefined();
    expect(latestStable([])).toBeUndefined();
  });
});
