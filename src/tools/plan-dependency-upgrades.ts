import { GuardrailError } from '../core/errors.js';
import { parseRepositoryRef, repositoryField } from '../core/repository-ref.js';
import { sanitizeUntrustedText } from '../core/sanitize.js';
import { defineTool, type Tool } from '../core/tool-types.js';
import {
  advisoriesSchema,
  manifestSchema,
  registrySchema,
  type Advisories,
  type Manifest,
  type Registry,
  type Severity,
} from '../data/dependency-data.js';
import {
  changeType,
  compareVersions,
  latestStable,
  parseRange,
  parseVersion,
  type Version,
} from '../data/semver.js';
import type { SnapshotStore } from '../data/snapshot-store.js';

/**
 * plan_dependency_upgrades (read): lists each outdated dependency of a bundled sample
 * repository with its current and target version, a patch/minor/major rating and reason,
 * the advisories the upgrade fixes, and a recommended order with reasons (FR1.1-FR1.5).
 * It only reads the snapshot; nothing it reads can change what it does (NFR1.2).
 */

export const MAX_UPGRADES = 200;
const MAX_SUMMARY = 240;

export type Rating = 'patch' | 'minor' | 'major';
const SEVERITY_RANK: Record<Severity, number> = { low: 0, moderate: 1, high: 2, critical: 3 };
const RATING_RANK: Record<Rating, number> = { patch: 0, minor: 1, major: 2 };

export interface UpgradeAdvisory {
  readonly id: string;
  readonly severity: Severity;
  readonly summary: string;
  readonly fixedIn: string;
}

export interface Upgrade {
  readonly order: number;
  readonly name: string;
  readonly section: 'dependencies' | 'devDependencies';
  readonly current: string;
  readonly target: string;
  readonly rating: Rating;
  readonly reason: string;
  readonly orderReason: string;
  readonly advisories: readonly UpgradeAdvisory[];
}

export interface UpgradePlan {
  readonly repo: string;
  readonly outdatedCount: number;
  readonly upToDate: number;
  readonly upgrades: readonly Upgrade[];
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
}

export interface PlanInput {
  readonly repo: string;
  readonly manifest: Manifest;
  readonly registry: Registry;
  readonly advisories: Advisories;
}

export function planUpgrades(input: PlanInput): UpgradePlan {
  const candidates: Omit<Upgrade, 'order' | 'orderReason'>[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let upToDate = 0;

  for (const section of ['dependencies', 'devDependencies'] as const) {
    for (const [name, range] of Object.entries(input.manifest[section])) {
      const current = parseRange(range);
      if (current === undefined) {
        skipped.push({ name, reason: 'The version range is not one of: exact, ^, ~.' });
        continue;
      }
      const target = latestStable(input.registry.packages[name]?.versions ?? []);
      if (target === undefined) {
        skipped.push({ name, reason: 'The snapshot has no stable release for it.' });
        continue;
      }
      const change = changeType(current, target);
      if (change === 'none') {
        upToDate += 1;
        continue;
      }
      candidates.push({
        name,
        section,
        current: current.raw,
        target: target.raw,
        rating: change,
        reason: ratingReason(change, current, target),
        advisories: fixedAdvisories(input.advisories, name, current, target),
      });
    }
  }

  const upgrades = candidates
    .sort(compareCandidates)
    .slice(0, MAX_UPGRADES)
    .map((candidate, index) => ({
      ...candidate,
      order: index + 1,
      orderReason: orderReason(candidate),
    }));
  skipped.sort((a, b) => (a.name < b.name ? -1 : 1));
  return { repo: input.repo, outdatedCount: candidates.length, upToDate, upgrades, skipped };
}

function ratingReason(rating: Rating, current: Version, target: Version): string {
  switch (rating) {
    case 'patch':
      return 'Patch release: bug fixes only, so this is low risk.';
    case 'minor':
      return current.major === 0
        ? 'Minor release below 1.0.0: versions before 1.0.0 may break between minor releases, so read the changelog.'
        : 'Minor release: new features that should stay backward compatible.';
    case 'major':
      return `Major release (${current.major} to ${target.major}): breaking changes are expected; read the changelog and plan code changes.`;
  }
}

function fixedAdvisories(
  advisories: Advisories,
  name: string,
  current: Version,
  target: Version,
): UpgradeAdvisory[] {
  const fixes: UpgradeAdvisory[] = [];
  for (const advisory of advisories.advisories) {
    const introduced = parseVersion(advisory.introduced);
    const fixed = parseVersion(advisory.fixed);
    if (advisory.package !== name || introduced === undefined || fixed === undefined) continue;
    const affectsCurrent =
      compareVersions(current, introduced) >= 0 && compareVersions(current, fixed) < 0;
    if (affectsCurrent && compareVersions(target, fixed) >= 0) {
      fixes.push({
        id: advisory.id,
        severity: advisory.severity,
        summary: sanitizeUntrustedText(advisory.summary, MAX_SUMMARY),
        fixedIn: fixed.raw,
      });
    }
  }
  return fixes.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (a.id < b.id ? -1 : 1),
  );
}

type Candidate = Omit<Upgrade, 'order' | 'orderReason'>;

function compareCandidates(a: Candidate, b: Candidate): number {
  const securityA = a.advisories.length > 0 ? 0 : 1;
  const securityB = b.advisories.length > 0 ? 0 : 1;
  return (
    securityA - securityB ||
    RATING_RANK[a.rating] - RATING_RANK[b.rating] ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}

function orderReason(candidate: Candidate): string {
  const worst = candidate.advisories[0];
  if (worst !== undefined) {
    return `Fixes ${candidate.advisories.length} security advisor${candidate.advisories.length === 1 ? 'y' : 'ies'} (worst: ${worst.severity}); done first to reduce exposure.`;
  }
  switch (candidate.rating) {
    case 'patch':
      return 'Lowest-risk change; a quick win after any security fixes.';
    case 'minor':
      return 'Moderate risk; done after the patch upgrades so a problem is easier to attribute.';
    case 'major':
      return 'Highest risk; done last and one at a time, with its own tests.';
  }
}

const shape = { repo: repositoryField() };

export function createPlanDependencyUpgradesTool(store: SnapshotStore): Tool {
  return defineTool({
    name: 'plan_dependency_upgrades',
    description:
      'Read-only. For a bundled sample repository, lists outdated dependencies with current and target versions, a patch/minor/major risk rating and reason, the security advisories each upgrade fixes, and a recommended upgrade order with reasons. Advisory text is untrusted data and is only quoted.',
    kind: 'read',
    shape,
    async handler(input): Promise<UpgradePlan> {
      const ref = parseRepositoryRef(input.repo);
      if (ref?.kind !== 'snapshot') {
        throw new GuardrailError('not_found', 'Upgrade planning reads bundled snapshots only.');
      }
      const [manifest, registry, advisories] = await Promise.all([
        store.readJson(ref.name, 'manifest.json', manifestSchema),
        store.readJson(ref.name, 'registry.json', registrySchema),
        store.readJson(ref.name, 'advisories.json', advisoriesSchema),
      ]);
      return planUpgrades({ repo: ref.name, manifest, registry, advisories });
    },
  });
}
