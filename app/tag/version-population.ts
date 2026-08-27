import semver from 'semver';
import { parse as parseSemver } from './index.js';

/**
 * #859: a bare integer tag ("168") is exactly what semver.coerce() turns
 * into "168.0.0" — a fake version whose inflated "major" can outrank a real
 * dotted release ("1.43.3"). Anything matching this pattern (an optional "v"
 * plus digits and nothing else) must never be compared against a real
 * version directly; see selectVersionPopulation/pickPreferredVersionTag.
 */
const BARE_INTEGER_TAG_PATTERN = /^v?\d+$/i;

// semver.coerce() (parse()'s last-resort fallback in app/tag/index.ts) can
// only emit a bare "major.minor.patch", silently discarding any suffix it
// didn't understand — a PEP 440 dev/post release ("2026.8.0.dev202607050315",
// "1.2.3.post1"), an OS-variant suffix ("3.11-bullseye"), or a CalVer date
// ("2024-01-15"). When coercion was required, the only raw shapes that
// provably lost nothing are an optional "v" plus 1-3 dot-separated numeric
// groups; anything else must not be offered as a stable pin target. See #473.
const BARE_NUMERIC_VERSION_PATTERN = /^v?\d+(?:\.\d+){0,2}$/i;

export interface VersionTagSource {
  /** The tag value to return when this source wins (e.g. the raw registry tag). */
  tag: string;
  /** The value semver classification runs against (e.g. after dd.tag.transform). */
  versionTag: string;
}

interface StableSemverCandidate {
  tag: string;
  major: number;
  minor: number;
  patch: number;
}

// NOTE: parse() in app/tag/index.ts also has a normalizeNumericMultiSegmentTag
// branch in its fallback chain, checked before the semver.clean/semver.parse
// steps mirrored here. That branch only matches tags with 4+ dot-separated
// numeric groups and always rewrites them to "major.minor.patch-<rest>", so
// any tag that hits it always comes back with a non-empty prerelease array
// and is already rejected by the prerelease check above before this guard
// runs. If that branch's behavior changes upstream, re-verify this invariant
// still holds.
function requiredCoercionFallback(tag: string): boolean {
  const cleaned = semver.clean(tag, { loose: true });
  return semver.parse(cleaned ?? tag) === null;
}

function isBareNumericVersion(tag: string): boolean {
  return BARE_NUMERIC_VERSION_PATTERN.test(tag.trim());
}

function isBareIntegerTag(tag: string): boolean {
  return BARE_INTEGER_TAG_PATTERN.test(tag.trim());
}

/**
 * A tag whose semver build-metadata suffix (e.g. "1.43.3+build.5") should
 * lose a tie against the same core version without it. parse()'s own
 * clean()+parse() path strips build metadata before it ever reaches the
 * caller, so this checks the raw tag text rather than the parsed result.
 */
function hasBuildMetadataSuffix(tag: string): boolean {
  return tag.includes('+');
}

/**
 * True when `tag` parses as a stable (no prerelease), coercion-safe semver
 * version. Bare integers and bare 1-3 part numeric versions ("168", "13.4")
 * pass this; prerelease-only tags ("1.44.0-rc.1") and coercion-lossy tags
 * ("3.11-bullseye") do not. Shared by tag/suggest.ts's suggested-tag badge.
 */
function isStableSemverCandidate(tag: string): StableSemverCandidate | null {
  const parsed = parseSemver(tag);
  if (!parsed) {
    return null;
  }

  const prerelease = Array.isArray(parsed.prerelease) ? parsed.prerelease : [];
  if (prerelease.length > 0) {
    return null;
  }

  if (requiredCoercionFallback(tag) && !isBareNumericVersion(tag)) {
    return null;
  }

  if (
    !Number.isInteger(parsed.major) ||
    !Number.isInteger(parsed.minor) ||
    !Number.isInteger(parsed.patch)
  ) {
    return null;
  }

  return {
    tag,
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
  };
}

/**
 * #859: partition an already include/exclude-filtered tag population and
 * decide which pool is safe to rank as "the version candidates" — never
 * letting a bare integer build counter (e.g. "168") compete directly against
 * a real dotted release (e.g. "1.43.3").
 *
 * `sources` pairs each candidate's classification value (`versionTag` — what
 * `isEligible` and semver parsing run against, e.g. after dd.tag.transform)
 * with the tag string to actually return (`tag`). For untransformed callers
 * the two are identical. `isEligible` lets each call site keep its own
 * eligibility rules (tag/suggest.ts's stable-only badge vs.
 * tag-candidates.ts's more permissive "parses as semver at all", which
 * tolerates prerelease tags) while sharing this same partition rule.
 *
 * Rule (caller must already have applied include/exclude filters):
 *  1. Partition `isEligible` candidates into `preferred` (not a bare integer
 *     tag) and `bareIntegers`.
 *  2. If `preferred` is non-empty, the winning pool is `preferred` — bare
 *     integers are discarded entirely, never compared against a real version.
 *  3. Else, if the population contains ANY tag that parses as semver at all
 *     and is not a bare integer — even one `isEligible` rejected, such as a
 *     prerelease-only tag or a coercion-lossy tag — refuse to offer a
 *     suggestion at all (empty pool). The repo clearly versions "for real",
 *     so substituting a build counter is unsafe. This is deliberate and
 *     conservative: it does not fall back to the integer.
 *  4. Else (the population is genuinely integer-only; non-version aliases
 *     like "latest"/"nightly" don't disqualify this case), the winning pool
 *     is `bareIntegers`.
 *
 * Returns the winning pool's sources, in source order (unsorted) — callers
 * apply their own ordering.
 */
export function selectVersionPopulation<T extends VersionTagSource>(
  sources: T[],
  isEligible: (source: T) => boolean,
): T[] {
  const eligible = sources.filter((source) => isEligible(source));

  const preferred = eligible.filter((source) => !isBareIntegerTag(source.versionTag));
  if (preferred.length > 0) {
    return preferred;
  }

  const hasNonIntegerVersionSignal = sources.some(
    (source) => parseSemver(source.versionTag) !== null && !isBareIntegerTag(source.versionTag),
  );
  if (hasNonIntegerVersionSignal) {
    return [];
  }

  return eligible.filter((source) => isBareIntegerTag(source.versionTag));
}

interface SortablePoolEntry extends StableSemverCandidate {
  hasBuildMetadata: boolean;
}

/**
 * Sort by major/minor/patch descending. Ties prefer the tag without a
 * semver build-metadata suffix (e.g. "1.43.3" over "1.43.3+build.5"),
 * regardless of input order, then fall back to a stable lexical tie-break.
 */
function sortStablePoolDescending(entries: SortablePoolEntry[]): void {
  entries.sort((a, b) => {
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    if (a.patch !== b.patch) return b.patch - a.patch;
    if (a.hasBuildMetadata !== b.hasBuildMetadata) return a.hasBuildMetadata ? 1 : -1;
    if (a.tag === b.tag) return 0;
    return a.tag < b.tag ? -1 : 1;
  });
}

interface StableCandidateSource extends VersionTagSource {
  candidate: StableSemverCandidate | null;
}

/**
 * #859: pick the single highest-ranked tag from an already include/exclude-
 * filtered, untransformed tag list, using the stable-only eligibility rules
 * (see isStableSemverCandidate) and never letting a bare integer tag outrank
 * a real dotted version. Used by tag/suggest.ts's suggested-tag badge and the
 * digest-comparison fallback in image-comparison.ts.
 */
export function pickPreferredVersionTag(tags: string[]): string | null {
  const sources: StableCandidateSource[] = tags.map((tag) => ({
    tag,
    versionTag: tag,
    candidate: isStableSemverCandidate(tag),
  }));

  const pool = selectVersionPopulation(sources, (source) => source.candidate !== null);

  if (pool.length === 0) {
    return null;
  }

  const candidates: SortablePoolEntry[] = pool.map((source) => ({
    // selectVersionPopulation only keeps sources whose isEligible callback
    // returned true above, i.e. sources with a non-null candidate.
    ...(source.candidate as StableSemverCandidate),
    hasBuildMetadata: hasBuildMetadataSuffix(source.tag),
  }));

  sortStablePoolDescending(candidates);
  return candidates[0].tag;
}
