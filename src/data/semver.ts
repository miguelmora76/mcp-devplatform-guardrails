/**
 * Semantic versions, in-house and dependency-free (NFR7.3). Only what upgrade planning
 * needs: strict parsing, precedence, the kind of change between two versions, the lowest
 * version a simple manifest range accepts, and the latest stable release of a list.
 */

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Dot-separated pre-release identifiers; empty for a release. */
  readonly prerelease: readonly string[];
  /** The version without build metadata, as `major.minor.patch[-prerelease]`. */
  readonly raw: string;
}

export type ChangeType = 'major' | 'minor' | 'patch' | 'none';

const NUMBER = '(0|[1-9]\\d*)';
const IDENTIFIER = '[0-9A-Za-z-]+';
const VERSION = new RegExp(
  `^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?(?:\\+${IDENTIFIER}(?:\\.${IDENTIFIER})*)?$`,
);

/** Parses `1.2.3`, `1.2.3-rc.1`, `1.2.3+build`; anything else (including `v1.2.3`) is refused. */
export function parseVersion(text: string): Version | undefined {
  const match = VERSION.exec(text);
  if (match === null) return undefined;
  const [, major, minor, patch, prerelease] = match;
  const core = `${major}.${minor}.${patch}`;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
    raw: prerelease === undefined ? core : `${core}-${prerelease}`,
  };
}

/** Negative when a < b, zero when equal, positive when a > b (build metadata is ignored). */
export function compareVersions(a: Version, b: Version): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    comparePrerelease(a.prerelease, b.prerelease)
  );
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  // A release outranks any of its pre-releases.
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const difference = compareIdentifier(a[i] ?? '', b[i] ?? '');
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function compareIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  // Numeric identifiers are lower than alphanumeric ones.
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The kind of upgrade from one version to a higher one; `none` if it is not higher. */
export function changeType(from: Version, to: Version): ChangeType {
  if (compareVersions(to, from) <= 0) return 'none';
  if (to.major !== from.major) return 'major';
  if (to.minor !== from.minor) return 'minor';
  return 'patch';
}

/** The lowest version accepted by `1.2.3`, `=1.2.3`, `^1.2.3` or `~1.2.3`; other ranges are unsupported. */
export function parseRange(range: string): Version | undefined {
  return parseVersion(range.trim().replace(/^[\^~=]/, ''));
}

/** The highest release (no pre-release) among the given version strings. */
export function latestStable(versions: readonly string[]): Version | undefined {
  let best: Version | undefined;
  for (const text of versions) {
    const version = parseVersion(text);
    if (version === undefined || version.prerelease.length > 0) continue;
    if (best === undefined || compareVersions(version, best) > 0) best = version;
  }
  return best;
}
